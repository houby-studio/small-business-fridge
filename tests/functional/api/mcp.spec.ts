import '#tests/test_context'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { createHash, randomBytes } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { store as throttleStore } from '#middleware/throttle_middleware'
import User from '#models/user'
import McpOauthClient from '#models/mcp_oauth_client'
import McpOauthCode from '#models/mcp_oauth_code'
import Category from '#models/category'
import Product from '#models/product'

const MCP_URL = '/mcp'

const MCP_INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  },
}

const cleanAll = async () => {
  await db.from('mcp_tool_calls').delete()
  await db.from('mcp_oauth_codes').delete()
  await db.from('mcp_oauth_clients').delete()
  await db.from('audit_logs').delete()
  await db.from('user_favorites').delete()
  await db.from('orders').delete()
  await db.from('invoices').delete()
  await db.from('deliveries').delete()
  await db.from('product_allergen').delete()
  await db.from('products').delete()
  await db.from('allergens').delete()
  await db.from('categories').delete()
  await db.from('auth_access_tokens').delete()
  await db.from('user_auth_identities').delete()
  await db.from('users').delete()
}

async function createToken(user: User) {
  const token = await User.accessTokens.create(user, ['*'], {
    name: 'test-mcp-token',
    expiresIn: '30 days',
  })
  return token.value!.release()
}

/** MCP Streamable HTTP: send a single JSON-RPC message and return the response. */
async function mcpPost(
  client: ApiClient,
  token: string,
  body: Record<string, unknown> | Record<string, unknown>[]
) {
  return client
    .post(MCP_URL)
    .header('Authorization', `Bearer ${token}`)
    .header('Accept', 'application/json, text/event-stream')
    .header('Content-Type', 'application/json')
    .json(body)
}

/**
 * Parses the MCP response body from either JSON (application/json) or SSE stream
 * (text/event-stream). Returns the first JSON-RPC message found, or null.
 */
function parseMcpBody(response: { body(): unknown; text(): string }): any {
  const text = response.text()
  if (text) {
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('data:')) {
        const json = trimmed.slice(5).trim()
        if (json) {
          try {
            return JSON.parse(json) as Record<string, unknown>
          } catch {
            // skip malformed line
          }
        }
      }
    }
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // not JSON
    }
  }
  const raw = response.body()
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return null
}

async function listToolNames(client: ApiClient, token: string): Promise<string[]> {
  const response = await mcpPost(client, token, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  })
  response.assertStatus(200)
  const message = parseMcpBody(response)
  return (message?.result?.tools ?? []).map((t: { name: string }) => t.name)
}

async function callTool(
  client: ApiClient,
  token: string,
  name: string,
  args: Record<string, unknown> = {}
) {
  const response = await mcpPost(client, token, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name, arguments: args },
  })
  response.assertStatus(200)
  const message = parseMcpBody(response)
  const content = message?.result?.content?.[0]?.text
  // Error results carry a plain-text message, success results a JSON payload.
  let data: any = null
  if (content) {
    try {
      data = JSON.parse(content)
    } catch {
      data = null
    }
  }
  return {
    isError: message?.result?.isError === true,
    data,
    raw: content,
  }
}

async function createStockedDelivery() {
  const category = await CategoryFactory.create()
  const supplier = await UserFactory.apply('supplier').create()
  const product = await ProductFactory.merge({ categoryId: category.id }).create()
  const delivery = await DeliveryFactory.merge({
    supplierId: supplier.id,
    productId: product.id,
    amountLeft: 5,
    price: 20,
  }).create()
  return { category, supplier, product, delivery }
}

const OAUTH_REDIRECT = 'https://claude.ai/api/mcp/auth_callback'

async function registerClient(client: ApiClient): Promise<string> {
  const registration = await client
    .post('/oauth/register')
    .json({ client_name: 'Claude', redirect_uris: [OAUTH_REDIRECT] })
  return registration.body().client_id
}

function authorizeQs(clientId: string) {
  return {
    client_id: clientId,
    redirect_uri: OAUTH_REDIRECT,
    response_type: 'code',
    code_challenge: 'abc',
    code_challenge_method: 'S256',
  }
}

/** GET shows the consent page (and stores the request in the session); POST approves it. */
async function authorizeWithConsent(client: ApiClient, user: User, qs: Record<string, string>) {
  const show = await client.get('/oauth/authorize').qs(qs).loginAs(user).redirects(0)
  show.assertStatus(200)
  return client
    .post('/oauth/authorize')
    .loginAs(user)
    .withSession({ mcpOauthConsent: show.session().mcpOauthConsent })
    .withCsrfToken()
    .json({ decision: 'approve' })
    .redirects(0)
}

test.group('API MCP - Authentication', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(cleanAll)

  test('returns 401 without Bearer token', async ({ client }) => {
    const response = await client
      .post(MCP_URL)
      .header('Content-Type', 'application/json')
      .json(MCP_INIT)

    response.assertStatus(401)
  })

  test('returns 401 with WWW-Authenticate resource_metadata header', async ({ client, assert }) => {
    const response = await client
      .post(MCP_URL)
      .header('Content-Type', 'application/json')
      .json(MCP_INIT)

    response.assertStatus(401)
    const wwwAuth = response.header('www-authenticate') as string
    assert.isString(wwwAuth)
    assert.include(wwwAuth, 'Bearer')
    assert.include(wwwAuth, 'resource_metadata=')
    assert.include(wwwAuth, '/.well-known/oauth-protected-resource')
  })

  test('returns 401 with invalid token', async ({ client }) => {
    const response = await client
      .post(MCP_URL)
      .header('Authorization', 'Bearer invalid-token-value')
      .header('Content-Type', 'application/json')
      .json(MCP_INIT)

    response.assertStatus(401)
  })

  test('accepts a valid Bearer token for initialize', async ({ client, assert }) => {
    const user = await UserFactory.create()
    const token = await createToken(user)

    const response = await mcpPost(client, token, MCP_INIT)
    response.assertStatus(200)
    const message = parseMcpBody(response)
    assert.equal(message?.result?.serverInfo?.name, 'fridgora-mcp')
  })

  test('rejects kiosk users with 403', async ({ client }) => {
    const kiosk = await UserFactory.apply('kiosk').create()
    const token = await createToken(kiosk)

    const response = await mcpPost(client, token, MCP_INIT)
    response.assertStatus(403)
  })

  test('rejects disabled users at authentication', async ({ client }) => {
    const disabled = await UserFactory.apply('disabled').create()
    const token = await createToken(disabled)

    // 401, not 403: the api guard refuses to authenticate a disabled account at all, so
    // the request never reaches the MCP role check. Tokens outlive the account state, so
    // this has to be enforced per request rather than only at issuance.
    const response = await mcpPost(client, token, MCP_INIT)
    response.assertStatus(401)
  })

  test('answers OPTIONS preflight with permissive CORS headers', async ({ client, assert }) => {
    const response = await client
      .options(MCP_URL)
      .header('Origin', 'https://claude.ai')
      .header('Access-Control-Request-Method', 'POST')

    response.assertStatus(204)
    assert.equal(response.header('access-control-allow-origin'), 'https://claude.ai')
    const methods = response.header('access-control-allow-methods') as string
    assert.include(methods, 'POST')
  })
})

test.group('API MCP - Role-based tools', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(cleanAll)

  test('customer sees customer tools but no supplier/admin tools', async ({ client, assert }) => {
    const user = await UserFactory.create()
    const names = await listToolNames(client, await createToken(user))

    assert.includeMembers(names, [
      'list_products',
      'buy_product',
      'get_my_orders',
      'get_my_invoices',
      'get_payment_qr',
      'request_payment',
      'get_recommendations',
    ])
    assert.notInclude(names, 'add_stock')
    assert.notInclude(names, 'generate_invoices')
    assert.notInclude(names, 'list_users')
    assert.notInclude(names, 'storno_order')
  })

  test('supplier additionally sees supplier tools but no admin tools', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const names = await listToolNames(client, await createToken(supplier))

    assert.includeMembers(names, [
      'list_products',
      'add_stock',
      'get_stock',
      'uninvoiced_summary',
      'generate_invoices',
      'approve_payment',
    ])
    assert.notInclude(names, 'list_users')
    assert.notInclude(names, 'storno_order')
  })

  test('admin sees customer, supplier and admin tools', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const names = await listToolNames(client, await createToken(admin))

    assert.includeMembers(names, [
      'list_products',
      'add_stock',
      'list_users',
      'update_user',
      'storno_order',
      'get_audit_logs',
      'dashboard_stats',
    ])
  })

  test('workflow prompt is exposed via prompts/list', async ({ client, assert }) => {
    const user = await UserFactory.create()
    const response = await mcpPost(client, await createToken(user), {
      jsonrpc: '2.0',
      id: 5,
      method: 'prompts/list',
      params: {},
    })
    response.assertStatus(200)
    const message = parseMcpBody(response)
    const prompts = (message?.result?.prompts ?? []).map((p: { name: string }) => p.name)
    assert.include(prompts, 'workflow')
  })
})

test.group('API MCP - Tool calls', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(cleanAll)

  test('list_products returns stocked products with deliveryId', async ({ client, assert }) => {
    const user = await UserFactory.create()
    const { product, delivery } = await createStockedDelivery()

    const result = await callTool(client, await createToken(user), 'list_products')
    assert.isFalse(result.isError)
    assert.lengthOf(result.data.products, 1)
    assert.equal(result.data.products[0].productId, product.id)
    assert.equal(result.data.products[0].deliveryId, delivery.id)
    assert.equal(result.data.products[0].price, 20)
  })

  test('buy_product purchases and decrements stock', async ({ client, assert }) => {
    const user = await UserFactory.create()
    const { delivery } = await createStockedDelivery()

    const result = await callTool(client, await createToken(user), 'buy_product', {
      deliveryId: delivery.id,
      quantity: 2,
    })
    assert.isFalse(result.isError)
    assert.equal(result.data.purchased, 2)
    assert.equal(result.data.totalCost, 40)

    await delivery.refresh()
    assert.equal(delivery.amountLeft, 3)

    const orderCount = await db.from('orders').where('buyer_id', user.id).count('* as c').first()
    assert.equal(Number(orderCount?.c), 2)
  })

  test('buy_product reports out of stock as tool error', async ({ client, assert }) => {
    const user = await UserFactory.create()
    const { delivery } = await createStockedDelivery()
    await delivery.merge({ amountLeft: 0 }).save()

    const result = await callTool(client, await createToken(user), 'buy_product', {
      deliveryId: delivery.id,
    })
    assert.isTrue(result.isError)
    assert.include(result.raw, 'OUT_OF_STOCK')
  })

  test('buy_product stops with a partial result when the next lot costs more', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()
    const { supplier, product, delivery: oldest } = await createStockedDelivery()
    await oldest.merge({ amountLeft: 1 }).save()
    const pricier = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 5,
      price: 25,
    }).create()
    await db
      .from('deliveries')
      .where('id', pricier.id)
      .update({ created_at: new Date(Date.now() + 60_000) })

    const result = await callTool(client, await createToken(user), 'buy_product', {
      productId: product.id,
      quantity: 3,
    })
    assert.isFalse(result.isError)
    assert.equal(result.data.purchased, 1)
    assert.equal(result.data.totalCost, 20)
    assert.include(result.data.warning, 'different price')
    await pricier.refresh()
    assert.equal(pricier.amountLeft, 5)
  })

  test('buy_product with a stale expectedPrice buys nothing', async ({ client, assert }) => {
    const user = await UserFactory.create()
    const { delivery } = await createStockedDelivery()

    const result = await callTool(client, await createToken(user), 'buy_product', {
      deliveryId: delivery.id,
      expectedPrice: 15,
    })
    assert.isTrue(result.isError)
    assert.include(result.raw, 'PRICE_CHANGED')
    await delivery.refresh()
    assert.equal(delivery.amountLeft, 5)
  })

  test('buy_product by productId takes the oldest lot, not the cheapest', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()
    const { supplier, product, delivery: oldest } = await createStockedDelivery()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 5,
      price: 5,
    }).create()

    const result = await callTool(client, await createToken(user), 'buy_product', {
      productId: product.id,
    })
    assert.isFalse(result.isError)
    await oldest.refresh()
    assert.equal(oldest.amountLeft, 4)
  })

  test('supplier invoicing flow: buy → uninvoiced_summary → generate_invoices', async ({
    client,
    assert,
  }) => {
    const buyer = await UserFactory.create()
    const { supplier, delivery } = await createStockedDelivery()
    const buyerToken = await createToken(buyer)
    const supplierToken = await createToken(supplier)

    const purchase = await callTool(client, buyerToken, 'buy_product', {
      deliveryId: delivery.id,
    })
    assert.isFalse(purchase.isError)

    const summary = await callTool(client, supplierToken, 'uninvoiced_summary')
    assert.isFalse(summary.isError)
    assert.lengthOf(summary.data.buyers, 1)
    assert.equal(summary.data.buyers[0].buyerId, buyer.id)
    assert.equal(summary.data.totalUninvoiced, 20)

    const generated = await callTool(client, supplierToken, 'generate_invoices')
    assert.isFalse(generated.isError)
    assert.lengthOf(generated.data.invoices, 1)
    const invoiceId = generated.data.invoices[0].invoiceId

    // Buyer sees the invoice and reports payment
    const myInvoices = await callTool(client, buyerToken, 'get_my_invoices')
    assert.equal(myInvoices.data.invoices[0].invoiceId, invoiceId)
    assert.equal(myInvoices.data.invoices[0].status, 'unpaid')

    const requested = await callTool(client, buyerToken, 'request_payment', { invoiceId })
    assert.isFalse(requested.isError)
    assert.equal(requested.data.status, 'awaiting')

    // Supplier approves
    const approved = await callTool(client, supplierToken, 'approve_payment', { invoiceId })
    assert.isFalse(approved.isError)
    assert.equal(approved.data.status, 'paid')
  })

  test('request_payment on foreign invoice returns FORBIDDEN tool error', async ({
    client,
    assert,
  }) => {
    const buyer = await UserFactory.create()
    const stranger = await UserFactory.create()
    const { supplier, delivery } = await createStockedDelivery()

    await callTool(client, await createToken(buyer), 'buy_product', { deliveryId: delivery.id })
    const generated = await callTool(client, await createToken(supplier), 'generate_invoices')
    const invoiceId = generated.data.invoices[0].invoiceId

    const result = await callTool(client, await createToken(stranger), 'request_payment', {
      invoiceId,
    })
    assert.isTrue(result.isError)
    assert.include(result.raw, 'FORBIDDEN')
  })

  test('admin can list users and storno an order', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const { delivery } = await createStockedDelivery()
    const adminToken = await createToken(admin)

    await callTool(client, await createToken(buyer), 'buy_product', { deliveryId: delivery.id })

    const users = await callTool(client, adminToken, 'list_users')
    assert.isFalse(users.isError)
    assert.isAbove(users.data.users.length, 1)

    const orders = await callTool(client, adminToken, 'list_all_orders')
    const orderId = orders.data.orders[0].orderId

    const storno = await callTool(client, adminToken, 'storno_order', { orderId })
    assert.isFalse(storno.isError)

    await delivery.refresh()
    assert.equal(delivery.amountLeft, 5)
  })

  test('tool calls are logged to mcp_tool_calls', async ({ client, assert }) => {
    const user = await UserFactory.create()
    await callTool(client, await createToken(user), 'list_products')

    // Fire-and-forget insert — give it a moment
    await new Promise((resolve) => setTimeout(resolve, 200))

    const row = await db.from('mcp_tool_calls').where('tool_name', 'list_products').first()
    assert.exists(row)
    assert.equal(Number(row.user_id), user.id)
    assert.isTrue(row.success)
  })
})

test.group('API MCP - OAuth server', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(cleanAll)

  test('discovery documents are served', async ({ client, assert }) => {
    const prm = await client.get('/.well-known/oauth-protected-resource')
    prm.assertStatus(200)
    assert.include(prm.body().resource, '/mcp')

    const as = await client.get('/.well-known/oauth-authorization-server')
    as.assertStatus(200)
    assert.include(as.body().authorization_endpoint, '/oauth/authorize')
    assert.include(as.body().token_endpoint, '/oauth/token')
    assert.include(as.body().registration_endpoint, '/oauth/register')
    assert.deepEqual(as.body().code_challenge_methods_supported, ['S256'])
  })

  test('dynamic client registration validates redirect uris', async ({ client, assert }) => {
    const bad = await client
      .post('/oauth/register')
      .json({ client_name: 'Evil', redirect_uris: ['javascript:alert(1)'] })
    bad.assertStatus(400)

    const good = await client
      .post('/oauth/register')
      .json({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] })
    good.assertStatus(201)
    assert.isString(good.body().client_id)
    assert.equal(good.body().token_endpoint_auth_method, 'none')
  })

  test('full PKCE flow: register → authorize (web session) → token → use at /mcp', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()

    // 1. Register a client
    const redirectUri = 'https://claude.ai/api/mcp/auth_callback'
    const registration = await client
      .post('/oauth/register')
      .json({ client_name: 'Claude', redirect_uris: [redirectUri] })
    registration.assertStatus(201)
    const clientId = registration.body().client_id

    // 2. Authorize with a logged-in web session
    const codeVerifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

    const authorize = await authorizeWithConsent(client, user, {
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: 'xyz',
    })

    authorize.assertStatus(302)
    const location = authorize.header('location') as string
    const url = new URL(location)
    assert.equal(url.searchParams.get('state'), 'xyz')
    const code = url.searchParams.get('code')!
    assert.isString(code)

    // 3. Exchange the code for a token (PKCE)
    const tokenResponse = await client.post('/oauth/token').json({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: clientId,
    })
    tokenResponse.assertStatus(200)
    const accessToken = tokenResponse.body().access_token
    assert.isString(accessToken)

    // 4. The issued token authenticates at /mcp
    const response = await mcpPost(client, accessToken, MCP_INIT)
    response.assertStatus(200)

    // 5. The code is single-use
    const replay = await client.post('/oauth/token').json({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: clientId,
    })
    replay.assertStatus(400)
  })

  test('token endpoint rejects a wrong code_verifier', async ({ client, assert }) => {
    const user = await UserFactory.create()
    const redirectUri = 'https://claude.ai/api/mcp/auth_callback'
    const registration = await client
      .post('/oauth/register')
      .json({ client_name: 'Claude', redirect_uris: [redirectUri] })
    const clientId = registration.body().client_id

    const codeChallenge = createHash('sha256').update('correct-verifier').digest('base64url')
    const authorize = await authorizeWithConsent(client, user, {
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
    const code = new URL(authorize.header('location') as string).searchParams.get('code')!

    const tokenResponse = await client.post('/oauth/token').json({
      grant_type: 'authorization_code',
      code,
      code_verifier: 'wrong-verifier',
      redirect_uri: redirectUri,
      client_id: clientId,
    })
    tokenResponse.assertStatus(400)
    assert.equal(tokenResponse.body().error, 'invalid_grant')
  })

  test('authorize redirects anonymous users to login with returnTo', async ({ client, assert }) => {
    const redirectUri = 'https://claude.ai/api/mcp/auth_callback'
    await McpOauthClient.create({
      clientId: 'test-client-id',
      clientName: 'Test',
      redirectUrisRaw: JSON.stringify([redirectUri]),
      grantTypesRaw: JSON.stringify(['authorization_code']),
    })

    const response = await client
      .get('/oauth/authorize')
      .qs({
        client_id: 'test-client-id',
        redirect_uri: redirectUri,
        response_type: 'code',
        code_challenge: 'abc',
        code_challenge_method: 'S256',
      })
      .redirects(0)

    response.assertStatus(302)
    assert.include(response.header('location') as string, '/login?returnTo=/oauth/authorize')
  })

  test('authorize shows a consent page and issues nothing on GET', async ({ client, assert }) => {
    const user = await UserFactory.create()
    const clientId = await registerClient(client)

    const response = await client
      .get('/oauth/authorize')
      .qs(authorizeQs(clientId))
      .loginAs(user)
      .redirects(0)

    response.assertStatus(200)
    assert.isUndefined(response.header('location'))
    assert.include(response.text(), 'auth/oauth_consent')
    assert.lengthOf(await McpOauthCode.all(), 0)
  })

  test('denying consent redirects back with access_denied and issues no code', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()
    const clientId = await registerClient(client)

    const show = await client
      .get('/oauth/authorize')
      .qs(authorizeQs(clientId))
      .loginAs(user)
      .redirects(0)
    const deny = await client
      .post('/oauth/authorize')
      .loginAs(user)
      .withSession({ mcpOauthConsent: show.session().mcpOauthConsent })
      .withCsrfToken()
      .json({ decision: 'deny' })
      .redirects(0)

    deny.assertStatus(302)
    const url = new URL(deny.header('location') as string)
    assert.equal(url.searchParams.get('error'), 'access_denied')
    assert.isNull(url.searchParams.get('code'))
    assert.lengthOf(await McpOauthCode.all(), 0)
  })

  test('approving without a pending request is refused', async ({ client, assert }) => {
    const user = await UserFactory.create()

    const response = await client
      .post('/oauth/authorize')
      .loginAs(user)
      .withCsrfToken()
      .json({ decision: 'approve' })
      .redirects(0)

    response.assertStatus(400)
    assert.lengthOf(await McpOauthCode.all(), 0)
  })

  test('authorize is refused while an admin impersonates the user', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const target = await UserFactory.create()
    const clientId = await registerClient(client)

    const response = await client
      .get('/oauth/authorize')
      .qs(authorizeQs(clientId))
      .loginAs(admin)
      .withSession({
        __impersonation: { byId: admin.id, asId: target.id, asName: target.displayName },
      })
      .redirects(0)

    response.assertStatus(403)
    assert.lengthOf(await McpOauthCode.all(), 0)
  })

  test('a code issued before the account was disabled yields no token', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()
    const clientId = await registerClient(client)
    const codeVerifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

    const authorize = await authorizeWithConsent(client, user, {
      ...authorizeQs(clientId),
      code_challenge: codeChallenge,
    })
    const code = new URL(authorize.header('location') as string).searchParams.get('code')!
    await user.merge({ isDisabled: true }).save()

    const tokenResponse = await client.post('/oauth/token').json({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: OAUTH_REDIRECT,
      client_id: clientId,
    })
    tokenResponse.assertStatus(400)
    assert.equal(tokenResponse.body().error, 'invalid_grant')
  })

  test('the issued token is named after the client and the owner is emailed', async ({
    client,
    assert,
  }) => {
    const fakeMailer = mail.fake()
    try {
      const user = await UserFactory.create()
      const clientId = await registerClient(client)
      const codeVerifier = randomBytes(32).toString('base64url')
      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
      const authorize = await authorizeWithConsent(client, user, {
        ...authorizeQs(clientId),
        code_challenge: codeChallenge,
      })
      const code = new URL(authorize.header('location') as string).searchParams.get('code')!

      const tokenResponse = await client.post('/oauth/token').json({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: OAUTH_REDIRECT,
        client_id: clientId,
      })
      tokenResponse.assertStatus(200)

      const token = await db.from('auth_access_tokens').where('tokenable_id', user.id).first()
      assert.equal(token.name, 'MCP: Claude')

      // Connecting a tool is as visible in the audit trail as creating a token by hand.
      const log = await db
        .from('audit_logs')
        .where('action', 'profile.token.created')
        .where('user_id', user.id)
        .firstOrFail()
      assert.deepEqual(log.metadata, {
        tokenId: token.id,
        tokenName: 'MCP: Claude',
        via: 'mcp_oauth',
        clientId,
        clientName: 'Claude',
      })
      await new Promise((resolve) => setTimeout(resolve, 50))
      fakeMailer.messages.assertSent((message) => message.hasTo(user.email))
    } finally {
      mail.restore()
    }
  })

  test('while impersonating the consent page explains why and offers to stop', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const target = await UserFactory.create()
    const clientId = await registerClient(client)

    const response = await client
      .get('/oauth/authorize')
      .qs(authorizeQs(clientId))
      .loginAs(admin)
      .withSession({
        __impersonation: { byId: admin.id, asId: target.id, asName: target.displayName },
      })
      .headers({ 'X-Inertia': 'true', 'X-Inertia-Version': '1' })

    response.assertStatus(403)
    assert.equal(response.body().props.blocked, 'impersonating')
  })

  test('authorize rejects an unregistered redirect_uri', async ({ client }) => {
    const user = await UserFactory.create()
    await McpOauthClient.create({
      clientId: 'test-client-id',
      clientName: 'Test',
      redirectUrisRaw: JSON.stringify(['https://claude.ai/api/mcp/auth_callback']),
      grantTypesRaw: JSON.stringify(['authorization_code']),
    })

    const response = await client
      .get('/oauth/authorize')
      .qs({
        client_id: 'test-client-id',
        redirect_uri: 'https://evil.example.com/steal',
        response_type: 'code',
        code_challenge: 'abc',
        code_challenge_method: 'S256',
      })
      .loginAs(user)
      .redirects(0)

    response.assertStatus(400)
  })
})

test.group('API MCP - create_product', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(cleanAll)

  test('a supplier can create a product without an image', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const token = await createToken(supplier)
    const category = await Category.create({ name: 'MCP kategorie', color: '#123456' })

    const response = await mcpPost(client, token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'create_product',
        arguments: {
          displayName: 'Produkt bez obrázku',
          description: 'Vytvořeno přes MCP',
          categoryId: category.id,
        },
      },
    })

    response.assertStatus(200)
    const product = await Product.query().where('displayName', 'Produkt bez obrázku').first()
    assert.isNotNull(product)
    assert.isNull(product!.imagePath)
  })
})

test.group('API MCP - audit log', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(cleanAll)

  const auditRow = (action: string) => db.from('audit_logs').where('action', action).firstOrFail()

  test('a purchase made through MCP is marked as such', async ({ client, assert }) => {
    const buyer = await UserFactory.create()
    const { delivery } = await createStockedDelivery()

    const result = await callTool(client, await createToken(buyer), 'buy_product', {
      deliveryId: delivery.id,
    })
    assert.isFalse(result.isError)

    const log = await auditRow('order.created')
    assert.equal(log.user_id, buyer.id)
    assert.equal(log.metadata.via, 'mcp')
  })

  test('update_user records what changed, like the web form', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const target = await UserFactory.create()

    const result = await callTool(client, await createToken(admin), 'update_user', {
      userId: target.id,
      role: 'supplier',
    })
    assert.isFalse(result.isError)

    const log = await auditRow('user.updated')
    assert.equal(log.user_id, admin.id)
    assert.deepEqual(log.metadata, { via: 'mcp', role: { from: 'customer', to: 'supplier' } })
  })

  test('storno_order records the cancelled item', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const { delivery } = await createStockedDelivery()
    await callTool(client, await createToken(buyer), 'buy_product', { deliveryId: delivery.id })
    const order = await db.from('orders').where('buyer_id', buyer.id).firstOrFail()

    const result = await callTool(client, await createToken(admin), 'storno_order', {
      orderId: order.id,
    })
    assert.isFalse(result.isError)

    const log = await auditRow('order.storno')
    assert.equal(log.user_id, admin.id)
    assert.equal(log.target_user_id, buyer.id)
    assert.deepInclude(log.metadata, {
      via: 'mcp',
      productId: delivery.productId,
      deliveryId: delivery.id,
      supplierId: delivery.supplierId,
      price: 20,
    })
  })

  test('create_product and update_product log the same shape as the web UI', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const token = await createToken(supplier)
    const category = await Category.create({ name: 'Audit kategorie', color: '#123456' })

    const created = await callTool(client, token, 'create_product', {
      displayName: 'Auditovaný produkt',
      categoryId: category.id,
    })
    assert.isFalse(created.isError)
    const createdLog = await auditRow('product.created')
    assert.deepEqual(createdLog.metadata, { via: 'mcp', name: 'Auditovaný produkt' })

    const updated = await callTool(client, token, 'update_product', {
      productId: created.data.productId,
      displayName: 'Přejmenovaný produkt',
    })
    assert.isFalse(updated.isError)
    const updatedLog = await auditRow('product.updated')
    assert.deepEqual(updatedLog.metadata, {
      via: 'mcp',
      name: { from: 'Auditovaný produkt', to: 'Přejmenovaný produkt' },
    })
  })
})
