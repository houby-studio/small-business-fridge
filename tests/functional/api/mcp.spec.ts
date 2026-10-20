import '#tests/test_context'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { createHash, randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
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
import { OrderFactory } from '#database/factories/order_factory'
import { InvoiceFactory } from '#database/factories/invoice_factory'
import DeliveryService from '#services/delivery_service'
import { settleSideEffects } from '#services/side_effects'
import { evalScenarios } from '#mcp/eval_scenarios'
import { liveToolDefinitions } from '../../../commands/mcp_eval.js'

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
  await db.from('stock_adjustments').delete()
  await db.from('inventory_count_items').delete()
  await db.from('inventory_counts').delete()
  await db.from('delivery_corrections').delete()
  await db.from('stock_draft_items').delete()
  await db.from('stock_drafts').delete()
  await db.from('shopping_list_items').delete()
  await db.from('shopping_lists').delete()
  await db.from('orders').delete()
  await db.from('invoices').delete()
  await db.from('deliveries').delete()
  await db.from('product_allergen').delete()
  await db.from('products').delete()
  await db.from('product_groups').delete()
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
      'recent_deliveries',
      'list_catalog_products',
      'create_product',
      'update_product',
      'uninvoiced_summary',
      'generate_invoices',
      'list_issued_invoices',
      'approve_payment',
      'reject_payment',
      'get_shopping_list',
      'update_shopping_list_line',
      'add_shopping_list_line',
      'list_product_groups',
      'create_product_group',
      'create_stock_draft',
      'list_stock_drafts',
      'get_stock_draft',
      'update_stock_draft',
      'discard_stock_draft',
      'commit_stock_draft',
      'write_off_stock',
      'void_delivery',
      'correct_delivery',
      'record_inventory_count',
      'classify_inventory_loss',
      'get_finance_summary',
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

test.group('API MCP - shopping, stocking drafts and earnings', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(cleanAll)

  test('suppliers get the new tools, customers do not', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const customer = await UserFactory.create()
    const supplierTools = await listToolNames(client, await createToken(supplier))
    const customerTools = await listToolNames(client, await createToken(customer))
    const added = [
      'get_shopping_list',
      'update_shopping_list_line',
      'add_shopping_list_line',
      'list_product_groups',
      'create_product_group',
      'create_stock_draft',
      'list_stock_drafts',
      'get_stock_draft',
      'update_stock_draft',
      'discard_stock_draft',
      'commit_stock_draft',
      'write_off_stock',
      'void_delivery',
      'correct_delivery',
      'record_inventory_count',
      'classify_inventory_loss',
      'list_stock_adjustments',
      'complete_shopping_list',
      'get_finance_summary',
    ]
    assert.includeMembers(supplierTools, added)
    for (const name of added) assert.notInclude(customerTools, name)
  })

  test('add_stock derives the selling price from the purchase price and margin', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    supplier.marginPercent = 5
    await supplier.save()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const token = await createToken(supplier)

    const result = await callTool(client, token, 'add_stock', {
      productId: product.id,
      amount: 24,
      purchasePrice: 14.9,
    })
    assert.isFalse(result.isError)
    assert.isTrue(result.data.stocked)
    assert.equal(result.data.price, 16)
    const lot = await db.from('deliveries').where('product_id', product.id).first()
    assert.equal(Number(lot.purchase_price), 14.9)

    const missing = await callTool(client, token, 'add_stock', { productId: product.id, amount: 1 })
    assert.isTrue(missing.isError)
    assert.include(missing.raw, 'PRICE_REQUIRED')
  })

  test('create_stock_draft prepares lines for review without stocking', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()

    const result = await callTool(client, await createToken(supplier), 'create_stock_draft', {
      note: 'Lidl 2. 10.',
      items: [
        { productId: product.id, label: 'PEPSI 0,33 PLECH', amount: 24, purchasePrice: 14.9 },
        { label: 'NEZNÁMÁ POLOŽKA', amount: 2, purchasePrice: 9.9 },
      ],
    })
    assert.isFalse(result.isError)
    assert.equal(result.data.lines, 2)
    assert.equal(result.data.unmatched, 1)
    assert.match(
      result.data.reviewUrl,
      new RegExp(`/supplier/stock/drafts/${result.data.draftId}$`)
    )
    assert.lengthOf(await db.from('deliveries'), 0)

    const audit = await db.from('audit_logs').where('action', 'stock_draft.created').first()
    assert.equal(audit.metadata.via, 'mcp')
  })

  test('purchase groups are created idempotently and assigned to products', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const token = await createToken(supplier)

    const created = await callTool(client, token, 'create_product_group', {
      name: 'Energy bez cukru',
      categoryId: category.id,
    })
    assert.isFalse(created.data.existed)
    const again = await callTool(client, token, 'create_product_group', {
      name: 'energy bez cukru',
      categoryId: category.id,
    })
    assert.isTrue(again.data.existed)
    assert.equal(again.data.groupId, created.data.groupId)

    const updated = await callTool(client, token, 'update_product', {
      productId: product.id,
      groupId: created.data.groupId,
    })
    assert.isFalse(updated.isError)
    const listed = await callTool(client, token, 'list_product_groups')
    assert.deepEqual(listed.data.groups[0].products, [
      { productId: product.id, name: product.displayName },
    ])

    const cleared = await callTool(client, token, 'update_product', {
      productId: product.id,
      groupId: null,
    })
    assert.isFalse(cleared.isError)
    const ungrouped = await Product.findOrFail(product.id)
    assert.isNull(ungrouped.productGroupId)
  })

  test('get_shopping_list and get_finance_summary answer for the supplier', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const token = await createToken(supplier)

    const list = await callTool(client, token, 'get_shopping_list', { horizonDays: 7 })
    assert.isFalse(list.isError)
    assert.equal(list.data.settings.horizonDays, 7)
    assert.isArray(list.data.lines)

    const finance = await callTool(client, token, 'get_finance_summary', {})
    assert.isFalse(finance.isError)
    assert.equal(finance.data.unitsSold, 0)
    assert.property(finance.data, 'incomeLimit')
  })
})

/**
 * The e-mails a tool started after answering (`runAfterResponse`), awaited for real — no
 * timeout to guess. None of them may have failed. Call `drainSideEffects()` before the tool,
 * so a task left over from an earlier test is not counted here.
 */
async function settled(assert: { deepEqual: (a: unknown, b: unknown) => void }) {
  const failures = await settleSideEffects()
  assert.deepEqual(
    failures.map((f) => `${f.label}: ${String(f.error)}`),
    []
  )
}

async function drainSideEffects() {
  await settleSideEffects()
}

/** Waits for a fire-and-forget side effect (e-mails are sent after the tool answered). */
async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for a side effect')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function supplierWithProduct() {
  const supplier = await UserFactory.apply('supplier').create()
  const category = await CategoryFactory.create()
  const product = await ProductFactory.merge({ categoryId: category.id }).create()
  const token = await createToken(supplier)
  return { supplier, category, product, token }
}

test.group('API MCP - stock out, drafts from chat and list edits', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(cleanAll)

  test('add_stock warns about a lot stocked minutes ago and stocks only with confirmWarnings', async ({
    client,
    assert,
  }) => {
    const { product, token } = await supplierWithProduct()

    const first = await callTool(client, token, 'add_stock', {
      productId: product.id,
      amount: 10,
      price: 20,
    })
    assert.isFalse(first.isError)
    assert.isTrue(first.data.stocked)
    assert.equal(first.data.price, 20)
    assert.include(first.data.hint, 'void_delivery')

    const repeated = await callTool(client, token, 'add_stock', {
      productId: product.id,
      amount: 10,
      price: 20,
    })
    assert.isFalse(repeated.isError)
    assert.isFalse(repeated.data.stocked)
    assert.equal(repeated.data.warnings.duplicate.amount, 10)
    assert.isNull(repeated.data.warnings.unusualPrice)
    assert.include(repeated.data.hint, 'confirmWarnings')
    assert.lengthOf(await db.from('deliveries'), 1)

    const confirmed = await callTool(client, token, 'add_stock', {
      productId: product.id,
      amount: 10,
      price: 20,
      confirmWarnings: true,
    })
    assert.isTrue(confirmed.data.stocked)
    assert.lengthOf(await db.from('deliveries'), 2)
  })

  test('add_stock flags an unusual price against the last lot', async ({ client, assert }) => {
    const { supplier, product, token } = await supplierWithProduct()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      price: 20,
      createdAt: DateTime.now().minus({ days: 2 }),
    }).create()

    const result = await callTool(client, token, 'add_stock', {
      productId: product.id,
      amount: 5,
      price: 60,
    })
    assert.isFalse(result.data.stocked)
    assert.isNull(result.data.warnings.duplicate)
    assert.equal(result.data.warnings.unusualPrice.lastPrice, 20)
  })

  test('add_stock e-mails users who favourited the product, like the web does', async ({
    client,
    assert,
  }) => {
    const fakeMailer = mail.fake()
    try {
      const { product, token } = await supplierWithProduct()
      const fan = await UserFactory.merge({ email: 'fan@example.com' }).create()
      await db.table('user_favorites').insert({
        user_id: fan.id,
        product_id: product.id,
        created_at: new Date(),
      })

      await drainSideEffects()
      const result = await callTool(client, token, 'add_stock', {
        productId: product.id,
        amount: 3,
        price: 15,
      })
      assert.isTrue(result.data.stocked)

      await settled(assert)
      fakeMailer.messages.assertSent((message) => message.hasTo('fan@example.com'))
    } finally {
      mail.restore()
    }
  })

  test('add_stock and create_product report unknown ids with a code and a hint', async ({
    client,
    assert,
  }) => {
    const { category, token } = await supplierWithProduct()

    const stock = await callTool(client, token, 'add_stock', {
      productId: 999_999,
      amount: 1,
      price: 10,
    })
    assert.isTrue(stock.isError)
    assert.include(stock.raw, '(error code: PRODUCT_NOT_FOUND)')
    assert.include(stock.raw, 'list_catalog_products')

    const product = await callTool(client, token, 'create_product', {
      displayName: 'Bez kategorie',
      categoryId: 999_999,
    })
    assert.isTrue(product.isError)
    assert.include(product.raw, '(error code: CATEGORY_NOT_FOUND)')
    assert.include(product.raw, 'list_categories')
    assert.notInclude(product.raw, 'foreign key')
    assert.lengthOf(await db.from('products').where('display_name', 'Bez kategorie'), 0)

    const noGroup = await callTool(client, token, 'create_product', {
      displayName: 'Bez skupiny',
      categoryId: category.id,
      groupId: 999_999,
    })
    assert.isTrue(noGroup.isError)
    assert.include(noGroup.raw, '(error code: GROUP_NOT_FOUND)')
  })

  test('write_off_stock takes pieces off the oldest lots and refuses more than is in stock', async ({
    client,
    assert,
  }) => {
    const { supplier, product, token } = await supplierWithProduct()
    const older = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 2,
      amountLeft: 2,
      price: 20,
      createdAt: DateTime.now().minus({ days: 3 }),
    }).create()
    const newer = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 5,
      amountLeft: 5,
      price: 20,
    }).create()

    const result = await callTool(client, token, 'write_off_stock', {
      productId: product.id,
      quantity: 3,
      reason: 'expired',
      note: 'prošlé',
    })
    assert.isFalse(result.isError)
    assert.equal(result.data.product, product.displayName)
    assert.deepEqual(result.data.lots, [
      { deliveryId: older.id, quantity: 2, supplier: supplier.displayName },
      { deliveryId: newer.id, quantity: 1, supplier: supplier.displayName },
    ])
    assert.include(result.data.hint, 'shrinkage')
    const left = await db.from('deliveries').where('id', newer.id).first()
    assert.equal(left.amount_left, 4)
    assert.equal(left.amount_lost, 1)
    const audit = await db.from('audit_logs').where('action', 'stock.written_off').first()
    assert.equal(audit.metadata.via, 'mcp')

    const tooMany = await callTool(client, token, 'write_off_stock', {
      productId: product.id,
      quantity: 10,
      reason: 'damaged',
    })
    assert.isTrue(tooMany.isError)
    assert.include(tooMany.raw, '(error code: NOT_ENOUGH_STOCK)')

    const unknown = await callTool(client, token, 'write_off_stock', {
      productId: 999_999,
      quantity: 1,
      reason: 'other',
    })
    assert.include(unknown.raw, '(error code: PRODUCT_NOT_FOUND)')
  })

  test('void_delivery cancels an unsold lot and refuses one something sold from', async ({
    client,
    assert,
  }) => {
    const { supplier, product, token } = await supplierWithProduct()
    const unsold = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 6,
      amountLeft: 6,
      price: 18,
    }).create()
    const sold = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 6,
      amountLeft: 5,
      price: 18,
    }).create()
    const buyer = await UserFactory.create()
    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: sold.id, unitPrice: 18 }).create()

    const voided = await callTool(client, token, 'void_delivery', {
      deliveryId: unsold.id,
      reason: 'duplicate — stocked twice',
    })
    assert.isFalse(voided.isError)
    assert.equal(voided.data.status, 'voided')
    assert.equal(voided.data.amountSupplied, 6)
    assert.equal(voided.data.product, product.displayName)
    const row = await db.from('deliveries').where('id', unsold.id).first()
    assert.isNotNull(row.voided_at)
    assert.equal(row.amount_left, 0)

    const refused = await callTool(client, token, 'void_delivery', {
      deliveryId: sold.id,
      reason: 'omyl',
    })
    assert.isTrue(refused.isError)
    assert.include(refused.raw, '(error code: DELIVERY_HAS_ORDERS)')
    assert.include(refused.raw, 'correct_delivery')

    const again = await callTool(client, token, 'void_delivery', {
      deliveryId: unsold.id,
      reason: 'ještě jednou',
    })
    assert.include(again.raw, '(error code: DELIVERY_VOIDED)')
  })

  test('void_delivery refuses a lot of another supplier', async ({ client, assert }) => {
    const { product, token } = await supplierWithProduct()
    const other = await UserFactory.apply('supplier').create()
    const foreign = await DeliveryFactory.merge({
      supplierId: other.id,
      productId: product.id,
    }).create()

    const result = await callTool(client, token, 'void_delivery', {
      deliveryId: foreign.id,
      reason: 'není moje',
    })
    assert.isTrue(result.isError)
    assert.include(result.raw, '(error code: FORBIDDEN)')
  })

  test('correct_delivery changes pieces and both prices, and reports NO_CHANGE', async ({
    client,
    assert,
  }) => {
    const { supplier, product, token } = await supplierWithProduct()
    const lot = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 10,
      amountLeft: 10,
      price: 20,
    }).create()

    const result = await callTool(client, token, 'correct_delivery', {
      deliveryId: lot.id,
      amount: 8,
      price: 25,
      purchasePrice: 14.9,
      reason: 'překlep v množství a ceně',
    })
    assert.isFalse(result.isError)
    assert.deepEqual(result.data.amountSupplied, { from: 10, to: 8 })
    assert.deepEqual(result.data.price, { from: 20, to: 25 })
    assert.deepEqual(result.data.purchasePrice, { from: null, to: 14.9 })
    assert.equal(result.data.amountLeft, 8)
    assert.equal(result.data.repricedOrders, 0)
    const row = await db.from('deliveries').where('id', lot.id).first()
    assert.equal(row.amount_left, 8)
    assert.equal(Number(row.purchase_price), 14.9)

    const same = await callTool(client, token, 'correct_delivery', {
      deliveryId: lot.id,
      amount: 8,
      price: 25,
      reason: 'nic nového',
    })
    assert.isTrue(same.isError)
    assert.include(same.raw, '(error code: NO_CHANGE)')

    const more = await callTool(client, token, 'correct_delivery', {
      deliveryId: lot.id,
      amount: 12,
      price: 25,
      reason: 'přidat kusy',
    })
    assert.include(more.raw, '(error code: AMOUNT_INCREASE_NOT_ALLOWED)')
    assert.include(more.raw, 'add_stock')
  })

  test('recent_deliveries hides voided lots unless asked and shows purchase prices and scope', async ({
    client,
    assert,
  }) => {
    const { supplier, product, token } = await supplierWithProduct()
    const other = await UserFactory.apply('supplier').create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      purchasePrice: 12.5,
    }).create()
    const voided = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
    }).create()
    await DeliveryFactory.merge({
      supplierId: other.id,
      productId: product.id,
      purchasePrice: 9.5,
    }).create()
    await callTool(client, token, 'void_delivery', { deliveryId: voided.id, reason: 'duplicita' })

    const mine = await callTool(client, token, 'recent_deliveries', {})
    assert.equal(mine.data.scope, 'mine')
    assert.lengthOf(mine.data.deliveries, 1)
    assert.equal(mine.data.deliveries[0].purchasePrice, 12.5)
    assert.equal(mine.data.deliveries[0].amountLost, 0)
    assert.property(mine.data.deliveries[0], 'price')
    assert.notProperty(mine.data.deliveries[0], 'unitPrice')

    const withVoided = await callTool(client, token, 'recent_deliveries', { includeVoided: true })
    assert.lengthOf(withVoided.data.deliveries, 2)
    assert.isTrue(withVoided.data.deliveries.some((d: any) => d.voided && d.corrections === 1))

    const all = await callTool(client, token, 'recent_deliveries', { scope: 'all' })
    assert.lengthOf(all.data.deliveries, 2)
    assert.includeMembers(
      all.data.deliveries.map((d: any) => d.supplier),
      [supplier.displayName, other.displayName]
    )
    // A colleague's purchase price is private; mine and the admin's view keep it.
    const theirs = all.data.deliveries.find((d: any) => d.supplier === other.displayName)
    assert.isNull(theirs.purchasePrice)
    const admin = await UserFactory.apply('admin').create()
    const asAdmin = await callTool(client, await createToken(admin), 'recent_deliveries', {
      scope: 'all',
    })
    const seen = asAdmin.data.deliveries.find((d: any) => d.supplier === other.displayName)
    assert.equal(seen.purchasePrice, 9.5)
  })

  test('get_stock takes scope and stockState and keeps the insights', async ({
    client,
    assert,
  }) => {
    const { supplier, product, token } = await supplierWithProduct()
    const other = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const theirs = await ProductFactory.merge({ categoryId: category.id }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 10,
      amountLeft: 2,
    }).create()
    await DeliveryFactory.merge({
      supplierId: other.id,
      productId: theirs.id,
      amountSupplied: 10,
      amountLeft: 10,
    }).create()

    const whole = await callTool(client, token, 'get_stock', {})
    assert.equal(whole.data.scope, 'all')
    assert.equal(whole.data.totals.totalProducts, 2)
    assert.property(whole.data, 'topMovers')
    assert.notInclude(whole.data.hint, 'record_inventory_count')
    assert.deepEqual(
      whole.data.lowStockItems.map((r: any) => r.productId),
      [product.id]
    )

    // The insights are the same on every page — only page 1 carries them.
    const second = await callTool(client, token, 'get_stock', { page: 2, perPage: 1 })
    assert.notProperty(second.data, 'topMovers')
    assert.notProperty(second.data, 'lowStockItems')

    const mine = await callTool(client, token, 'get_stock', { scope: 'mine' })
    assert.equal(mine.data.totals.totalProducts, 1)

    const low = await callTool(client, token, 'get_stock', { stockState: 'low' })
    assert.lengthOf(low.data.products, 1)
    assert.equal(low.data.products[0].productId, product.id)
  })

  test('list_catalog_products returns the purchase group of a product', async ({
    client,
    assert,
  }) => {
    const { category, product, token } = await supplierWithProduct()
    const energy = await callTool(client, token, 'create_product_group', {
      name: 'Energy s cukrem',
      categoryId: category.id,
      productIds: [product.id],
    })
    assert.isFalse(energy.data.existed)
    assert.deepEqual(energy.data.productIds, [product.id])

    const listed = await callTool(client, token, 'list_catalog_products', {
      search: product.displayName,
    })
    const row = listed.data.products.find((p: any) => p.productId === product.id)
    assert.equal(row.groupId, energy.data.groupId)
    assert.equal(row.groupName, 'Energy s cukrem')
  })

  test('create_product_group adds members to an existing group instead of ignoring them', async ({
    client,
    assert,
  }) => {
    const { category, product, token } = await supplierWithProduct()
    const second = await ProductFactory.merge({ categoryId: category.id }).create()
    const created = await callTool(client, token, 'create_product_group', {
      name: 'Tyčinky',
      categoryId: category.id,
      productIds: [product.id],
    })

    const again = await callTool(client, token, 'create_product_group', {
      name: 'tyčinky',
      categoryId: category.id,
      productIds: [product.id, second.id],
    })
    assert.isTrue(again.data.existed)
    assert.equal(again.data.groupId, created.data.groupId)
    assert.deepEqual(again.data.addedProductIds, [second.id])
    assert.sameMembers(again.data.productIds, [product.id, second.id])
    const row = await Product.findOrFail(second.id)
    assert.equal(row.productGroupId, created.data.groupId)

    const unchanged = await callTool(client, token, 'create_product_group', {
      name: 'Tyčinky',
      categoryId: category.id,
    })
    assert.deepEqual(unchanged.data.addedProductIds, [])
    assert.include(unchanged.data.hint, 'nothing changed')
  })

  test('update_product reports what changed and unknown ids by code', async ({
    client,
    assert,
  }) => {
    const { product, token } = await supplierWithProduct()

    const renamed = await callTool(client, token, 'update_product', {
      productId: product.id,
      displayName: 'Pepsi Max 0,33 l',
    })
    assert.isFalse(renamed.isError)
    assert.deepEqual(renamed.data.changes.name, {
      from: product.displayName,
      to: 'Pepsi Max 0,33 l',
    })

    const same = await callTool(client, token, 'update_product', {
      productId: product.id,
      displayName: 'Pepsi Max 0,33 l',
    })
    assert.deepEqual(same.data.changes, {})
    assert.include(same.data.hint, 'Nothing changed')

    const missing = await callTool(client, token, 'update_product', {
      productId: 999_999,
      displayName: 'x',
    })
    assert.include(missing.raw, '(error code: PRODUCT_NOT_FOUND)')
    const badCategory = await callTool(client, token, 'update_product', {
      productId: product.id,
      categoryId: 999_999,
    })
    assert.include(badCategory.raw, '(error code: CATEGORY_NOT_FOUND)')
  })

  test('a group line of a draft tells the agent which products it can pick', async ({
    client,
    assert,
  }) => {
    const { category, product, token } = await supplierWithProduct()
    const sibling = await ProductFactory.merge({ categoryId: category.id }).create()
    const outsider = await ProductFactory.merge({ categoryId: category.id }).create()
    const energy = await callTool(client, token, 'create_product_group', {
      name: 'Energy drink bez cukru',
      categoryId: category.id,
      productIds: [product.id, sibling.id],
    })
    assert.isFalse(energy.isError)

    // The shopping list hands over a group line: no product yet, just the group.
    const created = await callTool(client, token, 'create_stock_draft', {
      items: [{ groupId: energy.data.groupId, label: 'Energy drink bez cukru', amount: 12 }],
    })
    assert.isFalse(created.isError)

    const read = await callTool(client, token, 'get_stock_draft', { draftId: created.data.draftId })
    const line = read.data.items[0]
    assert.isNull(line.productId)
    assert.equal(line.groupName, 'Energy drink bez cukru')
    assert.sameMembers(
      line.groupProducts.map((p: any) => p.productId),
      [product.id, sibling.id]
    )
    assert.notInclude(
      line.groupProducts.map((p: any) => p.productId),
      outsider.id
    )
    assert.deepEqual(read.data.problems, [{ index: 0, problem: 'product' }])
  })

  test('a draft can be listed, read, fixed and stocked from chat', async ({ client, assert }) => {
    const { category, product, token } = await supplierWithProduct()
    const second = await ProductFactory.merge({ categoryId: category.id }).create()

    const created = await callTool(client, token, 'create_stock_draft', {
      note: 'Lidl',
      items: [
        { productId: product.id, label: 'PEPSI', amount: 24, purchasePrice: 14.9 },
        { label: 'MONSTER MANGO', amount: 12, purchasePrice: 24.9 },
      ],
    })
    assert.isFalse(created.isError)
    assert.equal(created.data.unmatched, 1)
    assert.deepEqual(created.data.problems, [{ index: 1, problem: 'product' }])
    const draftId = created.data.draftId

    const listed = await callTool(client, token, 'list_stock_drafts')
    const entry = listed.data.drafts.find((d: any) => d.draftId === draftId)
    assert.notProperty(entry, 'source')
    assert.equal(entry.lines, 2)
    assert.equal(entry.pieces, 36)
    assert.isFalse(entry.isEmpty)
    assert.match(entry.reviewUrl, new RegExp(`/supplier/stock/drafts/${draftId}$`))

    const read = await callTool(client, token, 'get_stock_draft', { draftId })
    assert.equal(read.data.status, 'open')
    assert.equal(read.data.items[0].product, product.displayName)
    assert.isNull(read.data.items[1].productId)
    assert.equal(read.data.items[1].label, 'MONSTER MANGO')

    const incomplete = await callTool(client, token, 'commit_stock_draft', { draftId })
    assert.isTrue(incomplete.isError)
    assert.include(incomplete.raw, '(error code: DRAFT_INCOMPLETE)')
    assert.include(incomplete.raw, 'update_stock_draft')

    const fixed = await callTool(client, token, 'update_stock_draft', {
      draftId,
      note: 'Lidl, opraveno',
      items: [
        { productId: product.id, label: 'PEPSI', amount: 24, purchasePrice: 14.9 },
        {
          productId: second.id,
          label: 'MONSTER MANGO',
          amount: 12,
          purchasePrice: 24.9,
          price: 30,
        },
      ],
    })
    assert.isFalse(fixed.isError)
    assert.deepEqual(fixed.data.problems, [])
    assert.equal(fixed.data.hint.slice(0, 5), 'Saved')
    // The draft's own note stays `note`; the tool's advice is `hint`.
    assert.equal(fixed.data.note, 'Lidl, opraveno')
    assert.equal(fixed.data.items[1].productId, second.id)
    assert.lengthOf(await db.from('deliveries'), 0)

    const committed = await callTool(client, token, 'commit_stock_draft', { draftId })
    assert.isFalse(committed.isError)
    assert.isTrue(committed.data.stocked)
    assert.lengthOf(committed.data.deliveries, 2)
    assert.equal(committed.data.deliveries[1].product, second.displayName)
    assert.equal(committed.data.deliveries[1].price, 30)
    assert.lengthOf(await db.from('deliveries'), 2)

    const closed = await callTool(client, token, 'get_stock_draft', { draftId })
    assert.equal(closed.data.status, 'committed')
    assert.isNotNull(closed.data.items[0].deliveryId)
    const stillOpen = await callTool(client, token, 'list_stock_drafts')
    assert.notInclude(
      stillOpen.data.drafts.map((d: any) => d.draftId),
      draftId
    )

    const twice = await callTool(client, token, 'commit_stock_draft', { draftId })
    assert.include(twice.raw, '(error code: DRAFT_CLOSED)')
    const editClosed = await callTool(client, token, 'update_stock_draft', {
      draftId,
      items: [{ productId: product.id, amount: 1, price: 10 }],
    })
    assert.include(editClosed.raw, '(error code: DRAFT_CLOSED)')
  })

  test('commit_stock_draft returns warnings and stocks only with confirmWarnings', async ({
    client,
    assert,
  }) => {
    const { product, token } = await supplierWithProduct()
    await callTool(client, token, 'add_stock', { productId: product.id, amount: 5, price: 20 })

    const created = await callTool(client, token, 'create_stock_draft', {
      items: [{ productId: product.id, label: 'PEPSI', amount: 5, price: 20 }],
    })
    const draftId = created.data.draftId

    const warned = await callTool(client, token, 'commit_stock_draft', { draftId })
    assert.isFalse(warned.isError)
    assert.isFalse(warned.data.stocked)
    assert.lengthOf(warned.data.warnings, 1)
    assert.equal(warned.data.warnings[0].productName, product.displayName)
    assert.isNotNull(warned.data.warnings[0].duplicate)
    assert.lengthOf(await db.from('deliveries'), 1)

    const stocked = await callTool(client, token, 'commit_stock_draft', {
      draftId,
      confirmWarnings: true,
    })
    assert.isTrue(stocked.data.stocked)
    assert.lengthOf(await db.from('deliveries'), 2)
  })

  test('discard_stock_draft closes a draft without touching the stock', async ({
    client,
    assert,
  }) => {
    const { product, token } = await supplierWithProduct()
    const created = await callTool(client, token, 'create_stock_draft', {
      items: [{ productId: product.id, label: 'PEPSI', amount: 5, price: 20 }],
    })
    const draftId = created.data.draftId

    const discarded = await callTool(client, token, 'discard_stock_draft', { draftId })
    assert.isFalse(discarded.isError)
    assert.equal(discarded.data.status, 'discarded')
    assert.lengthOf(await db.from('deliveries'), 0)
    const open = await callTool(client, token, 'list_stock_drafts')
    assert.lengthOf(open.data.drafts, 0)

    const again = await callTool(client, token, 'discard_stock_draft', { draftId })
    assert.include(again.raw, '(error code: DRAFT_CLOSED)')
    const missing = await callTool(client, token, 'get_stock_draft', { draftId: 999_999 })
    assert.include(missing.raw, '(error code: DRAFT_NOT_FOUND)')
  })

  test('draft lines need a product or a label and other suppliers cannot see the draft', async ({
    client,
    assert,
  }) => {
    const { product, token } = await supplierWithProduct()
    const unnamed = await callTool(client, token, 'create_stock_draft', {
      items: [{ amount: 2, purchasePrice: 9.9 }],
    })
    assert.isTrue(unnamed.isError)
    assert.include(unnamed.raw, '(error code: VALIDATION)')

    const created = await callTool(client, token, 'create_stock_draft', {
      items: [{ productId: product.id, amount: 2, purchasePrice: 9.9 }],
    })
    assert.isFalse(created.isError)
    const other = await UserFactory.apply('supplier').create()
    const foreign = await callTool(client, await createToken(other), 'get_stock_draft', {
      draftId: created.data.draftId,
    })
    assert.include(foreign.raw, '(error code: DRAFT_NOT_FOUND)')
  })

  test('record_inventory_count writes the shortfall off and classify_inventory_loss names it', async ({
    client,
    assert,
  }) => {
    const { supplier, category, product, token } = await supplierWithProduct()
    const intact = await ProductFactory.merge({ categoryId: category.id }).create()
    const lot = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 5,
      amountLeft: 5,
      price: 20,
    }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: intact.id,
      amountSupplied: 3,
      amountLeft: 3,
    }).create()

    const counted = await callTool(client, token, 'record_inventory_count', {
      scope: 'mine',
      note: 'páteční inventura',
      items: [
        { productId: product.id, expected: 5, counted: 3 },
        { productId: intact.id, expected: 3, counted: 3 },
      ],
    })
    assert.isFalse(counted.isError)
    assert.equal(counted.data.scope, 'mine')
    assert.equal(counted.data.products, 2)
    assert.equal(counted.data.lossQuantity, 2)
    assert.equal(counted.data.surplusQuantity, 0)
    assert.match(counted.data.detailUrl, new RegExp(`/supplier/inventory/${counted.data.countId}$`))
    const line = counted.data.items.find((i: any) => i.productId === product.id)
    assert.equal(line.applied, -2)
    assert.equal(line.product, product.displayName)
    const row = await db.from('deliveries').where('id', lot.id).first()
    assert.equal(row.amount_left, 3)
    assert.equal(row.amount_lost, 2)
    const adjustment = await db.from('stock_adjustments').where('product_id', product.id).first()
    assert.equal(adjustment.reason, 'inventory')

    const classified = await callTool(client, token, 'classify_inventory_loss', {
      countId: counted.data.countId,
      productId: product.id,
      reason: 'expired',
    })
    assert.isFalse(classified.isError)
    assert.isTrue(classified.data.changed)
    assert.equal(classified.data.product, product.displayName)
    const reclassified = await db.from('stock_adjustments').where('product_id', product.id).first()
    assert.equal(reclassified.reason, 'expired')

    const same = await callTool(client, token, 'classify_inventory_loss', {
      countId: counted.data.countId,
      productId: product.id,
      reason: 'expired',
    })
    assert.isFalse(same.data.changed)

    const nothing = await callTool(client, token, 'classify_inventory_loss', {
      countId: counted.data.countId,
      productId: intact.id,
      reason: 'stolen',
    })
    assert.isTrue(nothing.isError)
    assert.include(nothing.raw, '(error code: NOTHING_TO_CLASSIFY)')
  })

  test('record_inventory_count rejects unknown products and strangers cannot classify', async ({
    client,
    assert,
  }) => {
    const { supplier, product, token } = await supplierWithProduct()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 5,
      amountLeft: 5,
    }).create()

    const unknown = await callTool(client, token, 'record_inventory_count', {
      scope: 'all',
      items: [{ productId: 999_999, expected: 1, counted: 0 }],
    })
    assert.isTrue(unknown.isError)
    assert.include(unknown.raw, '(error code: PRODUCT_NOT_FOUND)')

    const counted = await callTool(client, token, 'record_inventory_count', {
      scope: 'all',
      items: [{ productId: product.id, expected: 5, counted: 4 }],
    })
    const stranger = await UserFactory.apply('supplier').create()
    const forbidden = await callTool(
      client,
      await createToken(stranger),
      'classify_inventory_loss',
      {
        countId: counted.data.countId,
        productId: product.id,
        reason: 'stolen',
      }
    )
    assert.isTrue(forbidden.isError)
    assert.include(forbidden.raw, '(error code: FORBIDDEN)')
  })

  test('shopping-list lines can be added and edited from chat', async ({ client, assert }) => {
    const { product, token } = await supplierWithProduct()

    const custom = await callTool(client, token, 'add_shopping_list_line', {
      label: 'Mléko do kávy',
      quantity: 2,
      unitCost: 24.9,
    })
    assert.isFalse(custom.isError)
    assert.match(custom.data.key, /^c-\d+$/)
    assert.equal(custom.data.line.name, 'Mléko do kávy')
    assert.equal(custom.data.line.quantity, 2)
    assert.equal(custom.data.line.unitCost, 24.9)

    const edited = await callTool(client, token, 'update_shopping_list_line', {
      key: custom.data.key,
      quantity: 3,
      isChecked: true,
      note: 'Petr chtěl',
    })
    assert.isFalse(edited.isError)
    assert.equal(edited.data.line.quantity, 3)
    assert.isTrue(edited.data.line.checked)
    assert.equal(edited.data.line.note, 'Petr chtěl')

    const byProduct = await callTool(client, token, 'add_shopping_list_line', {
      productId: product.id,
      quantity: 6,
    })
    assert.equal(byProduct.data.key, `p-${product.id}`)
    assert.equal(byProduct.data.line.productId, product.id)
    const list = await callTool(client, token, 'get_shopping_list', {})
    assert.includeMembers(
      list.data.lines.map((l: any) => l.key),
      [custom.data.key, `p-${product.id}`]
    )

    const hidden = await callTool(client, token, 'update_shopping_list_line', {
      key: `p-${product.id}`,
      isRemoved: true,
    })
    // The product never sold, so the planner does not suggest it: hidden, the line is gone.
    assert.isNull(hidden.data.line)
    assert.include(hidden.data.hint, 'Saved')
    const after = await callTool(client, token, 'get_shopping_list', {})
    assert.notInclude(
      after.data.lines.map((l: any) => l.key),
      `p-${product.id}`
    )

    const empty = await callTool(client, token, 'update_shopping_list_line', { key: 'c-1' })
    assert.include(empty.raw, '(error code: VALIDATION)')
    const unknownProduct = await callTool(client, token, 'update_shopping_list_line', {
      key: 'p-999999',
      quantity: 1,
    })
    assert.include(unknownProduct.raw, '(error code: PRODUCT_NOT_FOUND)')
    const nothing = await callTool(client, token, 'add_shopping_list_line', { quantity: 1 })
    assert.include(nothing.raw, '(error code: VALIDATION)')
  })

  test('get_finance_summary explains its units and links the report', async ({
    client,
    assert,
  }) => {
    const { token } = await supplierWithProduct()
    const finance = await callTool(client, token, 'get_finance_summary', {})
    assert.include(finance.data.hint, 'lossRate')
    assert.include(finance.data.hint, '/supplier/finance')
  })

  test('tools/list carries annotations: reads are flagged read-only, writes are not', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const response = await mcpPost(client, await createToken(admin), {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/list',
      params: {},
    })
    const tools: Array<{ name: string; annotations?: Record<string, unknown> }> =
      parseMcpBody(response).result.tools
    assert.isAbove(tools.length, 30)

    const readOnlyTools = [
      'list_products',
      'list_categories',
      'get_my_orders',
      'get_my_invoices',
      'get_payment_qr',
      'get_recommendations',
      'get_stock',
      'recent_deliveries',
      'list_catalog_products',
      'uninvoiced_summary',
      'list_issued_invoices',
      'get_shopping_list',
      'list_product_groups',
      'list_stock_drafts',
      'get_stock_draft',
      'list_stock_adjustments',
      'list_stock_lots',
      'list_stock_drafts',
      'get_finance_summary',
      'dashboard_stats',
      'list_users',
      'list_all_orders',
      'list_all_invoices',
      'get_audit_logs',
    ]
    const destructiveTools = [
      'buy_product',
      'add_stock',
      'generate_invoices',
      'generate_invoices_for_user',
      'approve_payment',
      'reject_payment',
      'storno_order',
      'write_off_stock',
      'void_delivery',
      'correct_delivery',
      'commit_stock_draft',
      'discard_stock_draft',
      'record_inventory_count',
      'reprice_stock',
      'revert_write_off',
      'void_stock_draft',
    ]

    for (const tool of tools) {
      const a = tool.annotations
      assert.isObject(a, `${tool.name} has no annotations`)
      assert.isString(a!.title, `${tool.name} has no title`)
      assert.isFalse(a!.openWorldHint, `${tool.name} should be openWorldHint: false`)
      assert.isBoolean(a!.readOnlyHint, `${tool.name} readOnlyHint`)
      assert.isBoolean(a!.destructiveHint, `${tool.name} destructiveHint`)
      assert.isBoolean(a!.idempotentHint, `${tool.name} idempotentHint`)
      if (readOnlyTools.includes(tool.name)) {
        assert.isTrue(a!.readOnlyHint, `${tool.name} should be read-only`)
        assert.isFalse(a!.destructiveHint, `${tool.name} should not be destructive`)
      } else {
        assert.isFalse(a!.readOnlyHint, `${tool.name} should not be read-only`)
      }
      if (destructiveTools.includes(tool.name)) {
        assert.isTrue(a!.destructiveHint, `${tool.name} should be destructive`)
      }
    }
    const names = tools.map((t) => t.name)
    assert.includeMembers(names, readOnlyTools)
    assert.includeMembers(names, destructiveTools)
  })

  test('every eval scenario names tools its role really gets from the live server', async ({
    assert,
  }) => {
    const [customerTools, supplierTools, adminTools] = await Promise.all([
      liveToolDefinitions('customer'),
      liveToolDefinitions('supplier'),
      liveToolDefinitions('admin'),
    ])
    const byRole = {
      customer: customerTools.map((t) => t.function.name),
      supplier: supplierTools.map((t) => t.function.name),
      admin: adminTools.map((t) => t.function.name),
    }
    assert.isAbove(byRole.customer.length, 5)
    assert.includeMembers(byRole.supplier, byRole.customer)
    assert.includeMembers(byRole.admin, byRole.supplier)
    assert.notInclude(byRole.customer, 'add_stock')
    assert.notInclude(byRole.supplier, 'list_users')

    const ids = evalScenarios.map((s) => s.id)
    assert.lengthOf(new Set(ids), ids.length, 'scenario ids must be unique')
    for (const scenario of evalScenarios) {
      const names = byRole[scenario.role]
      for (const tool of [scenario.expectedTool, ...(scenario.allowedTools ?? [])]) {
        assert.include(names, tool, `${scenario.id}: ${scenario.role} has no tool "${tool}"`)
      }
    }

    // Every mutating supplier tool is exercised by at least one scenario.
    const covered = new Set(
      evalScenarios.flatMap((s) => [s.expectedTool, ...(s.allowedTools ?? [])])
    )
    for (const name of [
      'add_stock',
      'create_stock_draft',
      'update_stock_draft',
      'discard_stock_draft',
      'commit_stock_draft',
      'write_off_stock',
      'void_delivery',
      'correct_delivery',
      'record_inventory_count',
      'classify_inventory_loss',
      'update_shopping_list_line',
      'add_shopping_list_line',
      'generate_invoices',
    ]) {
      assert.isTrue(covered.has(name), `no eval scenario covers ${name}`)
    }
  })
})

/** A supplier's lot with one purchase by `buyer` (and none invoiced yet). */
async function lotSoldTo(buyer: User, supplier?: User) {
  const owner = supplier ?? (await UserFactory.apply('supplier').create())
  const category = await CategoryFactory.create()
  const product = await ProductFactory.merge({ categoryId: category.id }).create()
  const delivery = await DeliveryFactory.merge({
    supplierId: owner.id,
    productId: product.id,
    amountSupplied: 10,
    amountLeft: 9,
    price: 20,
  }).create()
  await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id, unitPrice: 20 }).create()
  return { supplier: owner, product, delivery, token: await createToken(owner) }
}

const sentTo = (fake: ReturnType<typeof mail.fake>, address: string) =>
  fake.messages.sent().filter((message) => message.hasTo(address))

test.group('API MCP - e-mails, payment states and invoicing guards', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(cleanAll)

  test('invoicing and payments over MCP e-mail the same people as the web', async ({
    client,
    assert,
  }) => {
    const fakeMailer = mail.fake()
    try {
      const buyer = await UserFactory.merge({ email: 'kupec@example.com' }).create()
      const seller = await UserFactory.apply('supplier')
        .merge({ email: 'prodejce@example.com' })
        .create()
      const { token } = await lotSoldTo(buyer, seller)
      const buyerToken = await createToken(buyer)
      await drainSideEffects()

      const generated = await callTool(client, token, 'generate_invoices', { expectedTotal: 20 })
      assert.isFalse(generated.isError)
      const invoiceId = generated.data.invoices[0].invoiceId
      await settled(assert)
      assert.lengthOf(sentTo(fakeMailer, 'kupec@example.com'), 1)

      await callTool(client, buyerToken, 'request_payment', { invoiceId })
      // Reporting the same payment again does not e-mail the supplier twice.
      await callTool(client, buyerToken, 'request_payment', { invoiceId })

      const approved = await callTool(client, token, 'approve_payment', { invoiceId })
      assert.isFalse(approved.isError)
      await settled(assert)
      assert.lengthOf(sentTo(fakeMailer, 'prodejce@example.com'), 1)
      assert.lengthOf(sentTo(fakeMailer, 'kupec@example.com'), 2)

      const again = await callTool(client, token, 'approve_payment', { invoiceId })
      assert.isTrue(again.isError)
      assert.include(again.raw, '(error code: ALREADY_PAID)')
    } finally {
      mail.restore()
    }
  })

  test('an admin correct_delivery over MCP e-mails the repriced buyer and the supplier', async ({
    client,
    assert,
  }) => {
    const fakeMailer = mail.fake()
    try {
      const admin = await UserFactory.apply('admin').create()
      const buyer = await UserFactory.merge({ email: 'opravy-kupec@example.com' }).create()
      const seller = await UserFactory.apply('supplier')
        .merge({ email: 'opravy-dodavatel@example.com' })
        .create()
      const { delivery } = await lotSoldTo(buyer, seller)

      const corrected = await callTool(client, await createToken(admin), 'correct_delivery', {
        deliveryId: delivery.id,
        price: 25,
        reason: 'překlep v ceně',
      })
      assert.isFalse(corrected.isError)
      assert.equal(corrected.data.repricedOrders, 1)
      await waitFor(
        () =>
          sentTo(fakeMailer, 'opravy-kupec@example.com').length === 1 &&
          sentTo(fakeMailer, 'opravy-dodavatel@example.com').length === 1
      )
      await new Promise((resolve) => setTimeout(resolve, 150))
      assert.lengthOf(sentTo(fakeMailer, 'opravy-kupec@example.com'), 1)
    } finally {
      mail.restore()
    }
  })

  test('storno_order e-mails the buyer and the supplier of the lot', async ({ client, assert }) => {
    const fakeMailer = mail.fake()
    try {
      const admin = await UserFactory.apply('admin').create()
      const buyer = await UserFactory.merge({ email: 'storno-kupec@example.com' }).create()
      const seller = await UserFactory.apply('supplier')
        .merge({ email: 'storno-dodavatel@example.com' })
        .create()
      const { delivery } = await lotSoldTo(buyer, seller)
      const order = await db.from('orders').where('delivery_id', delivery.id).firstOrFail()

      const adminToken = await createToken(admin)
      await drainSideEffects()
      const storno = await callTool(client, adminToken, 'storno_order', { orderId: order.id })
      assert.isFalse(storno.isError)
      await settled(assert)
      assert.lengthOf(sentTo(fakeMailer, 'storno-kupec@example.com'), 1)
      assert.lengthOf(sentTo(fakeMailer, 'storno-dodavatel@example.com'), 1)
    } finally {
      mail.restore()
    }
  })

  test('reject_payment refuses a confirmed or unreported payment and a foreign invoice', async ({
    client,
    assert,
  }) => {
    const buyer = await UserFactory.create()
    const { supplier, token } = await lotSoldTo(buyer)
    const generated = await callTool(client, token, 'generate_invoices')
    const invoiceId = generated.data.invoices[0].invoiceId

    const unreported = await callTool(client, token, 'reject_payment', { invoiceId })
    assert.isTrue(unreported.isError)
    assert.include(unreported.raw, '(error code: NOTHING_TO_REJECT)')

    await callTool(client, await createToken(buyer), 'request_payment', { invoiceId })
    const stranger = await UserFactory.apply('supplier').create()
    const foreign = await callTool(client, await createToken(stranger), 'reject_payment', {
      invoiceId,
    })
    assert.include(foreign.raw, '(error code: FORBIDDEN)')

    await callTool(client, token, 'approve_payment', { invoiceId })
    const confirmed = await callTool(client, token, 'reject_payment', { invoiceId })
    assert.isTrue(confirmed.isError)
    assert.include(confirmed.raw, '(error code: PAYMENT_ALREADY_CONFIRMED)')
    const row = await db.from('invoices').where('id', invoiceId).first()
    assert.isTrue(row.is_paid)
    assert.equal(Number(row.supplier_id), supplier.id)
  })

  test('generate_invoices issues nothing when the total changed since the preview', async ({
    client,
    assert,
  }) => {
    const buyer = await UserFactory.create()
    const { supplier, delivery, token } = await lotSoldTo(buyer)
    // The supplier's own purchase is no debt: left out of the total, flagged in the summary.
    await OrderFactory.merge({
      buyerId: supplier.id,
      deliveryId: delivery.id,
      unitPrice: 20,
    }).create()

    const summary = await callTool(client, token, 'uninvoiced_summary')
    assert.equal(summary.data.totalUninvoiced, 20)
    assert.equal(summary.data.ownConsumption, 20)
    const own = summary.data.buyers.find((b: any) => b.buyerId === supplier.id)
    assert.isTrue(own.isSelf)

    // Someone buys between the preview and the confirmation.
    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id, unitPrice: 20 }).create()
    const stale = await callTool(client, token, 'generate_invoices', {
      expectedTotal: summary.data.totalUninvoiced,
    })
    assert.isTrue(stale.isError)
    assert.include(stale.raw, '(error code: TOTAL_CHANGED)')
    assert.lengthOf(await db.from('invoices'), 0)

    const fresh = await callTool(client, token, 'generate_invoices', { expectedTotal: 40 })
    assert.isFalse(fresh.isError)
    assert.lengthOf(fresh.data.invoices, 2)
    const self = fresh.data.invoices.find((i: any) => i.buyerId === supplier.id)
    assert.isTrue(self.isSelf)
  })

  test('generate_invoices for one buyer leaves the others; awaiting lists reported payments', async ({
    client,
    assert,
  }) => {
    const petr = await UserFactory.create()
    const jana = await UserFactory.create()
    const { delivery, token } = await lotSoldTo(petr)
    await OrderFactory.merge({ buyerId: jana.id, deliveryId: delivery.id, unitPrice: 20 }).create()

    const one = await callTool(client, token, 'generate_invoices', {
      buyerId: petr.id,
      expectedTotal: 20,
    })
    assert.isFalse(one.isError)
    assert.deepEqual(
      one.data.invoices.map((i: any) => i.buyerId),
      [petr.id]
    )
    const left = await callTool(client, token, 'uninvoiced_summary')
    assert.deepEqual(
      left.data.buyers.map((b: any) => b.buyerId),
      [jana.id]
    )

    await callTool(client, await createToken(petr), 'request_payment', {
      invoiceId: one.data.invoices[0].invoiceId,
    })
    await callTool(client, token, 'generate_invoices', { buyerId: jana.id })
    const awaiting = await callTool(client, token, 'list_issued_invoices', { status: 'awaiting' })
    assert.deepEqual(
      awaiting.data.invoices.map((i: any) => [i.buyerId, i.status]),
      [[petr.id, 'awaiting']]
    )
  })

  test('a tool error is logged as a failed call with its code', async ({ client, assert }) => {
    const { token } = await supplierWithProduct()
    const result = await callTool(client, token, 'add_stock', {
      productId: 999_999,
      amount: 1,
      price: 10,
    })
    assert.isTrue(result.isError)
    await new Promise((resolve) => setTimeout(resolve, 200))

    const row = await db.from('mcp_tool_calls').where('tool_name', 'add_stock').first()
    assert.isFalse(row.success)
    assert.include(row.error_message, 'PRODUCT_NOT_FOUND')
  })

  test('results are compact JSON', async ({ client, assert }) => {
    const { token } = await supplierWithProduct()
    const result = await callTool(client, token, 'list_catalog_products')
    assert.notInclude(result.raw, '\n')
  })
})

test.group('API MCP - catalog, counts and drafts (review round 2)', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(cleanAll)

  test('create_product returns the product of the same barcode; update reports BARCODE_TAKEN', async ({
    client,
    assert,
  }) => {
    const { category, product, token } = await supplierWithProduct()
    await product.merge({ barcode: '8590121052023' }).save()

    const same = await callTool(client, token, 'create_product', {
      displayName: 'KOFOLA 2L',
      categoryId: category.id,
      barcode: '8590121052023',
    })
    assert.isFalse(same.isError)
    assert.isTrue(same.data.existed)
    assert.equal(same.data.matchedBy, 'barcode')
    assert.equal(same.data.productId, product.id)

    const other = await ProductFactory.merge({ categoryId: category.id }).create()
    const taken = await callTool(client, token, 'update_product', {
      productId: other.id,
      barcode: '8590121052023',
    })
    assert.isTrue(taken.isError)
    assert.include(taken.raw, '(error code: BARCODE_TAKEN)')
    assert.include(taken.raw, 'list_catalog_products')
  })

  test('names match exactly: "_" is no wildcard for products and groups', async ({
    client,
    assert,
  }) => {
    const { category, token } = await supplierWithProduct()
    await ProductFactory.merge({ categoryId: category.id, displayName: 'Energy drink' }).create()
    const created = await callTool(client, token, 'create_product', {
      displayName: '  Energy_drink ',
      categoryId: category.id,
    })
    assert.isFalse(created.data.existed)
    assert.equal(created.data.displayName, 'Energy_drink')

    const drinks = await callTool(client, token, 'create_product_group', {
      name: 'Energy drink',
      categoryId: category.id,
    })
    const underscore = await callTool(client, token, 'create_product_group', {
      name: 'Energy_drink',
      categoryId: category.id,
    })
    assert.isFalse(underscore.data.existed)
    assert.notEqual(underscore.data.groupId, drinks.data.groupId)

    const otherCategory = await CategoryFactory.create()
    const reused = await callTool(client, token, 'create_product_group', {
      name: 'energy drink',
      categoryId: otherCategory.id,
    })
    assert.isTrue(reused.data.existed)
    assert.deepEqual(reused.data.ignored, ['categoryId'])
  })

  test('allergens are given by name; an unknown name lists the valid ones', async ({
    client,
    assert,
  }) => {
    const { category, product, token } = await supplierWithProduct()
    const now = new Date()
    await db.table('allergens').insert([
      { name: 'Lepek', is_disabled: false, created_at: now, updated_at: now },
      { name: 'Mléko', is_disabled: false, created_at: now, updated_at: now },
    ])

    const created = await callTool(client, token, 'create_product', {
      displayName: 'Sušenka',
      categoryId: category.id,
      allergens: ['lepek', 'MLÉKO'],
    })
    assert.isFalse(created.isError)
    const attached = await db
      .from('product_allergen')
      .where('product_id', created.data.productId)
      .count('* as c')
      .first()
    assert.equal(Number(attached?.c), 2)

    const unknown = await callTool(client, token, 'update_product', {
      productId: product.id,
      allergens: ['Ořechy'],
    })
    assert.isTrue(unknown.isError)
    assert.include(unknown.raw, '(error code: ALLERGEN_NOT_FOUND)')
    assert.include(unknown.raw, 'Lepek, Mléko')
  })

  test("record_inventory_count compares with every supplier's lots when expected is left out", async ({
    client,
    assert,
  }) => {
    const { supplier, product, token } = await supplierWithProduct()
    const colleague = await UserFactory.apply('supplier').create()
    const mine = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 5,
      amountLeft: 5,
      createdAt: DateTime.now().minus({ days: 2 }),
    }).create()
    await DeliveryFactory.merge({
      supplierId: colleague.id,
      productId: product.id,
      amountSupplied: 5,
      amountLeft: 5,
    }).create()

    // All 10 are on the shelf: "mine" is only a label, nothing is found or lost.
    const full = await callTool(client, token, 'record_inventory_count', {
      scope: 'mine',
      items: [{ productId: product.id, counted: 10 }],
    })
    assert.isFalse(full.isError)
    assert.equal(full.data.items[0].expected, 10)
    assert.equal(full.data.surplusQuantity, 0)
    assert.lengthOf(await db.from('stock_adjustments'), 0)

    const short = await callTool(client, token, 'record_inventory_count', {
      items: [{ productId: product.id, counted: 8 }],
    })
    assert.equal(short.data.scope, 'all')
    assert.equal(short.data.lossQuantity, 2)
    await mine.refresh()
    assert.equal(mine.amountLeft, 3)
  })

  test('write_off_stock names the supplier of every lot it took pieces from', async ({
    client,
    assert,
  }) => {
    const { product, token } = await supplierWithProduct()
    const colleague = await UserFactory.apply('supplier').create()
    await DeliveryFactory.merge({
      supplierId: colleague.id,
      productId: product.id,
      amountSupplied: 3,
      amountLeft: 3,
    }).create()

    const result = await callTool(client, token, 'write_off_stock', {
      productId: product.id,
      quantity: 1,
      reason: 'damaged',
    })
    assert.isFalse(result.isError)
    assert.equal(result.data.lots[0].supplier, colleague.displayName)
  })

  test('list_stock_adjustments finds the countId of an older count', async ({ client, assert }) => {
    const { supplier, product, token } = await supplierWithProduct()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 10,
      amountLeft: 10,
    }).create()
    await callTool(client, token, 'write_off_stock', {
      productId: product.id,
      quantity: 1,
      reason: 'expired',
    })
    const counted = await callTool(client, token, 'record_inventory_count', {
      items: [{ productId: product.id, counted: 7 }],
    })

    const counts = await callTool(client, token, 'list_stock_adjustments', { origin: 'inventory' })
    assert.isFalse(counts.isError)
    assert.lengthOf(counts.data.adjustments, 1)
    assert.equal(counts.data.adjustments[0].countId, counted.data.countId)
    assert.equal(counts.data.adjustments[0].reason, 'inventory')
    assert.equal(counts.data.adjustments[0].quantity, 2)

    const writeOffs = await callTool(client, token, 'list_stock_adjustments', {
      origin: 'write_off',
    })
    assert.lengthOf(writeOffs.data.adjustments, 1)
    assert.equal(writeOffs.data.adjustments[0].reason, 'expired')
    assert.notProperty(writeOffs.data.adjustments[0], 'countId')

    // Named later in another conversation: the countId from the list is enough.
    const classified = await callTool(client, token, 'classify_inventory_loss', {
      countId: counts.data.adjustments[0].countId,
      productId: product.id,
      reason: 'stolen',
    })
    assert.isTrue(classified.data.changed)
  })

  test('correct_delivery changes only what is passed', async ({ client, assert }) => {
    const { supplier, product, token } = await supplierWithProduct()
    const lot = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 24,
      amountLeft: 24,
      price: 18,
    }).create()

    const priceOnly = await callTool(client, token, 'correct_delivery', {
      deliveryId: lot.id,
      price: 28,
      reason: 'překlep v ceně',
    })
    assert.isFalse(priceOnly.isError)
    assert.deepEqual(priceOnly.data.amountSupplied, { from: 24, to: 24 })
    assert.deepEqual(priceOnly.data.price, { from: 18, to: 28 })

    const amountOnly = await callTool(client, token, 'correct_delivery', {
      deliveryId: lot.id,
      amount: 20,
      reason: 'bylo jich 20',
    })
    assert.deepEqual(amountOnly.data.price, { from: 28, to: 28 })
    assert.deepEqual(amountOnly.data.amountSupplied, { from: 24, to: 20 })

    const nothing = await callTool(client, token, 'correct_delivery', {
      deliveryId: lot.id,
      reason: 'nic',
    })
    assert.include(nothing.raw, '(error code: VALIDATION)')
  })

  test('draft tools refuse unknown products and groups instead of dropping them', async ({
    client,
    assert,
  }) => {
    const { product, token } = await supplierWithProduct()
    const unknownProduct = await callTool(client, token, 'create_stock_draft', {
      items: [{ productId: 999_999, amount: 6 }],
    })
    assert.isTrue(unknownProduct.isError)
    assert.include(unknownProduct.raw, '(error code: PRODUCT_NOT_FOUND)')
    assert.include(unknownProduct.raw, 'Line 0')
    assert.lengthOf(await db.from('stock_drafts'), 0)

    const created = await callTool(client, token, 'create_stock_draft', {
      items: [{ productId: product.id, amount: 6, price: 20 }],
    })
    const unknownGroup = await callTool(client, token, 'update_stock_draft', {
      draftId: created.data.draftId,
      lines: [{ index: 0, groupId: 999_999 }],
    })
    assert.include(unknownGroup.raw, '(error code: GROUP_NOT_FOUND)')
  })

  test('update_stock_draft patches single lines by index and keeps the rest', async ({
    client,
    assert,
  }) => {
    const { category, product, token } = await supplierWithProduct()
    const monster = await ProductFactory.merge({ categoryId: category.id }).create()
    const created = await callTool(client, token, 'create_stock_draft', {
      items: [
        { productId: product.id, label: 'PEPSI', amount: 24, purchasePrice: 14.9 },
        { label: 'COLA', amount: 6, purchasePrice: 19.9 },
        { label: 'MONSTER MANGO', amount: 12, purchasePrice: 24.9 },
      ],
    })
    const draftId = created.data.draftId

    const patched = await callTool(client, token, 'update_stock_draft', {
      draftId,
      lines: [{ index: 2, productId: monster.id, price: 35 }],
    })
    assert.isFalse(patched.isError)
    assert.lengthOf(patched.data.items, 3)
    assert.equal(patched.data.items[2].productId, monster.id)
    assert.equal(patched.data.items[2].label, 'MONSTER MANGO')
    assert.equal(patched.data.items[2].amount, 12)
    assert.equal(patched.data.items[2].price, 35)
    assert.equal(patched.data.items[0].productId, product.id)
    assert.equal(patched.data.items[1].label, 'COLA')

    const outside = await callTool(client, token, 'update_stock_draft', {
      draftId,
      lines: [{ index: 3, amount: 1 }],
    })
    assert.include(outside.raw, '(error code: VALIDATION)')
    assert.include(outside.raw, 'from 0 to 2')
    const both = await callTool(client, token, 'update_stock_draft', {
      draftId,
      lines: [{ index: 0, amount: 1 }],
      items: [{ productId: product.id, amount: 1 }],
    })
    assert.include(both.raw, '(error code: VALIDATION)')
  })

  test('complete_shopping_list turns the list into a draft and closes it', async ({
    client,
    assert,
  }) => {
    const { product, token } = await supplierWithProduct()
    await callTool(client, token, 'add_shopping_list_line', { productId: product.id, quantity: 6 })
    await callTool(client, token, 'add_shopping_list_line', { label: 'Mléko do kávy', quantity: 2 })

    const completed = await callTool(client, token, 'complete_shopping_list')
    assert.isFalse(completed.isError)
    assert.equal(completed.data.items[0].source, 'shopping_list')
    assert.equal(completed.data.added, 1)
    assert.equal(completed.data.status, 'open')
    assert.equal(completed.data.items[0].productId, product.id)
    assert.equal(completed.data.items[0].amount, 6)
    assert.equal(completed.data.freeTextLines, 1)
    assert.include(completed.data.hint, 'update_stock_draft')
    assert.include(completed.data.note, 'Mléko do kávy')
    assert.lengthOf(await db.from('deliveries'), 0)

    const again = await callTool(client, token, 'complete_shopping_list')
    assert.isTrue(again.isError)
    assert.include(again.raw, '(error code: LIST_EMPTY)')
  })

  test('shopping-list lines leave out empty fields', async ({ client, assert }) => {
    const { token } = await supplierWithProduct()
    const custom = await callTool(client, token, 'add_shopping_list_line', {
      label: 'Banány',
      quantity: 3,
    })
    assert.notProperty(custom.data.line, 'productId')
    assert.notProperty(custom.data.line, 'checked')
    assert.notProperty(custom.data.line, 'note')
    assert.equal(custom.data.line.quantity, 3)
  })

  test('get_finance_summary with byProduct adds the per-product breakdown', async ({
    client,
    assert,
  }) => {
    const buyer = await UserFactory.create()
    const { product, token } = await lotSoldTo(buyer)

    const plain = await callTool(client, token, 'get_finance_summary', {})
    assert.notProperty(plain.data, 'products')

    const detailed = await callTool(client, token, 'get_finance_summary', {
      byProduct: true,
      sortBy: 'grossProfit',
    })
    assert.isFalse(detailed.isError)
    assert.equal(detailed.data.products[0].productId, product.id)
    assert.equal(detailed.data.products[0].revenue, 20)
    assert.isNull(detailed.data.products[0].grossProfit)
    assert.equal(detailed.data.productsMeta.total, 1)
  })
})

test.group('API MCP - e-mail verification gate', (group) => {
  const previous = process.env.AUTH_EMAIL_VERIFICATION_REQUIRED
  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
    process.env.AUTH_EMAIL_VERIFICATION_REQUIRED = 'true'
  })
  group.each.teardown(async () => {
    if (previous === undefined) delete process.env.AUTH_EMAIL_VERIFICATION_REQUIRED
    else process.env.AUTH_EMAIL_VERIFICATION_REQUIRED = previous
    await cleanAll()
  })

  test('an unverified account is refused like on the web; a verified one works', async ({
    client,
    assert,
  }) => {
    const unverified = await UserFactory.apply('supplier').merge({ emailVerifiedAt: null }).create()
    const refused = await mcpPost(client, await createToken(unverified), MCP_INIT)
    refused.assertStatus(403)
    assert.include(refused.body().error_description, 'Verify your e-mail')

    const verified = await UserFactory.apply('supplier').create()
    const allowed = await mcpPost(client, await createToken(verified), MCP_INIT)
    allowed.assertStatus(200)
  })
})

test.group('API MCP - a supplier who leaves', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(cleanAll)

  test('update_user refuses to switch off a supplier with stock and says how much', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const { supplier } = await lotSoldTo(buyer)

    const result = await callTool(client, await createToken(admin), 'update_user', {
      userId: supplier.id,
      isDisabled: true,
    })
    assert.isTrue(result.isError)
    assert.include(result.raw, '(error code: SUPPLIER_HAS_OPEN_BUSINESS)')
    assert.include(result.raw, '9 pieces in 1 lots, 1 uninvoiced purchases')
    await supplier.refresh()
    assert.isFalse(supplier.isDisabled)
  })

  test('an admin settles payments of a supplier who left, not of an active one', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const adminToken = await createToken(admin)
    const buyer = await UserFactory.create()
    const gone = await UserFactory.apply('supplier').merge({ isDisabled: true }).create()
    const active = await UserFactory.apply('supplier').create()
    const orphaned = await InvoiceFactory.merge({ supplierId: gone.id, buyerId: buyer.id })
      .apply('paymentRequested')
      .create()
    const theirs = await InvoiceFactory.merge({ supplierId: active.id, buyerId: buyer.id })
      .apply('paymentRequested')
      .create()

    const approved = await callTool(client, adminToken, 'approve_payment', {
      invoiceId: orphaned.id,
    })
    assert.isFalse(approved.isError)
    const row = await db.from('invoices').where('id', orphaned.id).first()
    assert.isTrue(row.is_paid)

    const refused = await callTool(client, adminToken, 'reject_payment', { invoiceId: theirs.id })
    assert.isTrue(refused.isError)
    assert.include(refused.raw, '(error code: ISSUER_ACTIVE)')

    // A supplier is not an admin: someone else's invoice stays FORBIDDEN.
    const stranger = await callTool(client, await createToken(active), 'approve_payment', {
      invoiceId: orphaned.id,
    })
    assert.include(stranger.raw, '(error code: FORBIDDEN)')
  })
})

test.group('API MCP - repricing, reverting and archive (wave 2)', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(cleanAll)

  test('reprice_stock changes only my pieces left; sold pieces and colleagues stay', async ({
    client,
    assert,
  }) => {
    const buyer = await UserFactory.create()
    const { product, delivery, token } = await lotSoldTo(buyer)
    const colleague = await UserFactory.apply('supplier').create()
    const theirs = await DeliveryFactory.merge({
      supplierId: colleague.id,
      productId: product.id,
      amountSupplied: 4,
      amountLeft: 4,
      price: 20,
    }).create()

    const result = await callTool(client, token, 'reprice_stock', {
      productId: product.id,
      price: 15,
    })
    assert.isFalse(result.isError)
    assert.equal(result.data.pieces, 9)
    await delivery.refresh()
    assert.equal(delivery.price, 15)
    await theirs.refresh()
    assert.equal(theirs.price, 20)
    const order = await db.from('orders').where('delivery_id', delivery.id).firstOrFail()
    assert.equal(order.unit_price, 20)

    const same = await callTool(client, token, 'reprice_stock', {
      productId: product.id,
      price: 15,
    })
    assert.include(same.raw, '(error code: NO_CHANGE)')
    const other = await ProductFactory.merge({ categoryId: product.categoryId }).create()
    const nothing = await callTool(client, token, 'reprice_stock', {
      productId: other.id,
      price: 9,
    })
    assert.include(nothing.raw, '(error code: NOTHING_IN_STOCK)')
  })

  test('reprice_stock with lots changes exact lots; a colleague’s only for an admin', async ({
    client,
    assert,
  }) => {
    const fakeMailer = mail.fake()
    try {
      const buyer = await UserFactory.create()
      const { supplier, product, delivery, token } = await lotSoldTo(buyer)
      const colleague = await UserFactory.apply('supplier').create()
      const theirs = await DeliveryFactory.merge({
        supplierId: colleague.id,
        productId: product.id,
        amountSupplied: 4,
        amountLeft: 4,
        price: 20,
      }).create()

      const listed = await callTool(client, token, 'list_stock_lots', { productId: product.id })
      assert.deepEqual(
        listed.data.lots.map((l: any) => [l.deliveryId, l.mine, l.editable]),
        [
          [delivery.id, true, true],
          [theirs.id, false, false],
        ]
      )

      const refused = await callTool(client, token, 'reprice_stock', {
        productId: product.id,
        lots: [{ deliveryId: theirs.id, price: 12 }],
      })
      assert.include(refused.raw, '(error code: FORBIDDEN)')
      await theirs.refresh()
      assert.equal(theirs.price, 20)

      const admin = await UserFactory.apply('admin').create()
      const adminToken = await createToken(admin)
      const done = await callTool(client, adminToken, 'reprice_stock', {
        productId: product.id,
        lots: [
          { deliveryId: delivery.id, price: 18 },
          { deliveryId: theirs.id, price: 12 },
        ],
      })
      assert.isFalse(done.isError)
      assert.equal(done.data.pieces, 13)
      assert.deepEqual(
        done.data.lots.map((l: any) => [l.deliveryId, l.from, l.to, l.pieces]),
        [
          [delivery.id, 20, 18, 9],
          [theirs.id, 20, 12, 4],
        ]
      )
      await settled(assert)
      assert.lengthOf(sentTo(fakeMailer, supplier.email), 1)
      assert.lengthOf(sentTo(fakeMailer, colleague.email), 1)

      // A lot of another product is not this product's lot.
      const other = await ProductFactory.merge({ categoryId: product.categoryId }).create()
      const wrong = await callTool(client, adminToken, 'reprice_stock', {
        productId: other.id,
        lots: [{ deliveryId: theirs.id, price: 10 }],
      })
      assert.include(wrong.raw, '(error code: DELIVERY_NOT_FOUND)')
    } finally {
      mail.restore()
    }
  })

  test('a write-off can be listed as revertible and taken back once', async ({
    client,
    assert,
  }) => {
    const { supplier, product, token } = await supplierWithProduct()
    const lot = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 5,
      amountLeft: 5,
    }).create()
    await callTool(client, token, 'write_off_stock', {
      productId: product.id,
      quantity: 2,
      reason: 'damaged',
    })

    const listed = await callTool(client, token, 'list_stock_adjustments', { origin: 'write_off' })
    const row = listed.data.adjustments[0]
    assert.isTrue(row.revertible)
    assert.notProperty(row, 'revertedAt')

    const reverted = await callTool(client, token, 'revert_write_off', { adjustmentId: row.id })
    assert.isFalse(reverted.isError)
    assert.isString(reverted.data.revertedAt)
    await lot.refresh()
    assert.equal(lot.amountLeft, 5)

    const again = await callTool(client, token, 'revert_write_off', { adjustmentId: row.id })
    assert.include(again.raw, '(error code: ALREADY_REVERTED)')
    const after = await callTool(client, token, 'list_stock_adjustments', { origin: 'write_off' })
    assert.isString(after.data.adjustments[0].revertedAt)
    assert.notProperty(after.data.adjustments[0], 'revertible')

    await callTool(client, token, 'record_inventory_count', {
      items: [{ productId: product.id, counted: 4 }],
    })
    const counts = await callTool(client, token, 'list_stock_adjustments', { origin: 'inventory' })
    const count = await callTool(client, token, 'revert_write_off', {
      adjustmentId: counts.data.adjustments[0].id,
    })
    assert.include(count.raw, '(error code: NOT_A_WRITE_OFF)')
  })

  test('archived products are found only with includeArchived', async ({ client, assert }) => {
    const { product, token } = await supplierWithProduct()
    await db.from('products').where('id', product.id).update({ archived_at: new Date() })

    const hidden = await callTool(client, token, 'list_catalog_products', {
      search: product.displayName,
    })
    assert.lengthOf(hidden.data.products, 0)
    const shown = await callTool(client, token, 'list_catalog_products', {
      search: product.displayName,
      includeArchived: true,
    })
    assert.equal(shown.data.products[0].productId, product.id)
    assert.isTrue(shown.data.products[0].archived)
  })

  test('get_finance_summary reports the limit by payment and where the money is', async ({
    client,
    assert,
  }) => {
    const buyer = await UserFactory.create()
    const { token } = await lotSoldTo(buyer)
    const finance = await callTool(client, token, 'get_finance_summary', {})
    assert.isFalse(finance.isError)
    assert.property(finance.data, 'money')
    assert.equal(finance.data.money.uninvoiced, 20)
    assert.include(finance.data.hint, 'payment date')
  })
})

test.group('API MCP - stocked drafts', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(cleanAll)

  test('a stocked draft is listed with canVoid and voided as a whole', async ({
    client,
    assert,
  }) => {
    const { product, token } = await supplierWithProduct()
    const created = await callTool(client, token, 'create_stock_draft', {
      items: [{ productId: product.id, amount: 6, price: 20 }],
    })
    const draftId = created.data.draftId
    await callTool(client, token, 'commit_stock_draft', { draftId, confirmWarnings: true })

    const stocked = await callTool(client, token, 'list_stock_drafts', { status: 'committed' })
    assert.equal(stocked.data.drafts[0].draftId, draftId)
    assert.isTrue(stocked.data.drafts[0].canVoid)
    const open = await callTool(client, token, 'list_stock_drafts')
    assert.lengthOf(open.data.drafts, 0)

    const voided = await callTool(client, token, 'void_stock_draft', {
      draftId,
      reason: 'účtenka naskladněná dvakrát',
    })
    assert.isFalse(voided.isError)
    assert.equal(voided.data.voidedDeliveries, 1)
    const lot = await db.from('deliveries').where('product_id', product.id).firstOrFail()
    assert.isNotNull(lot.voided_at)

    const again = await callTool(client, token, 'void_stock_draft', { draftId, reason: 'znovu' })
    assert.include(again.raw, '(error code: DRAFT_VOIDED)')
  })

  test('a draft whose stock was handed over cannot be voided', async ({ client, assert }) => {
    const { supplier, product, token } = await supplierWithProduct()
    const created = await callTool(client, token, 'create_stock_draft', {
      items: [{ productId: product.id, amount: 6, price: 20 }],
    })
    const draftId = created.data.draftId
    await callTool(client, token, 'commit_stock_draft', { draftId, confirmWarnings: true })
    const admin = await UserFactory.apply('admin').create()
    const colleague = await UserFactory.apply('supplier').create()
    await new DeliveryService().transferStock(supplier.id, colleague.id, admin)

    const refused = await callTool(client, token, 'void_stock_draft', { draftId, reason: 'omyl' })
    assert.isTrue(refused.isError)
    assert.include(refused.raw, '(error code: DRAFT_TRANSFERRED)')
    assert.include(refused.raw, 'correct_delivery')
  })

  test('a draft something sold from cannot be voided', async ({ client, assert }) => {
    const { product, token } = await supplierWithProduct()
    const created = await callTool(client, token, 'create_stock_draft', {
      items: [{ productId: product.id, amount: 6, price: 20 }],
    })
    const draftId = created.data.draftId
    await callTool(client, token, 'commit_stock_draft', { draftId, confirmWarnings: true })
    const buyer = await UserFactory.create()
    await callTool(client, await createToken(buyer), 'buy_product', { productId: product.id })

    const stocked = await callTool(client, token, 'list_stock_drafts', { status: 'committed' })
    assert.notProperty(stocked.data.drafts[0], 'canVoid')
    const refused = await callTool(client, token, 'void_stock_draft', { draftId, reason: 'omyl' })
    assert.include(refused.raw, '(error code: DRAFT_HAS_SALES)')
    assert.include(refused.raw, 'correct_delivery')
  })
})

test.group('API MCP - one open stocking draft', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(cleanAll)

  test('a second receipt is appended to the open draft, each line keeps its source', async ({
    client,
    assert,
  }) => {
    const { category, product, token } = await supplierWithProduct()
    const cola = await ProductFactory.merge({ categoryId: category.id }).create()

    const first = await callTool(client, token, 'create_stock_draft', {
      note: 'Lidl',
      items: [{ productId: product.id, amount: 6, price: 20 }],
    })
    assert.isTrue(first.data.created)
    assert.equal(first.data.added, 1)

    const second = await callTool(client, token, 'create_stock_draft', {
      note: 'Billa',
      items: [
        { productId: cola.id, amount: 12, purchasePrice: 19.9 },
        { productId: product.id, amount: 6, price: 22 },
      ],
    })
    assert.isFalse(second.isError)
    assert.isFalse(second.data.created)
    assert.equal(second.data.added, 2)
    assert.equal(second.data.draftId, first.data.draftId)
    assert.equal(second.data.lines, 3)
    assert.include(second.data.hint, 'Added 2 line(s)')
    assert.deepEqual(
      second.data.items.map((i: any) => i.source),
      ['assistant', 'assistant', 'assistant']
    )
    assert.include(second.data.note, 'Lidl')
    assert.include(second.data.note, 'Billa')

    const open = await callTool(client, token, 'list_stock_drafts')
    assert.lengthOf(open.data.drafts, 1)
    assert.lengthOf(await db.from('stock_drafts').where('status', 'open'), 1)
  })

  test('the shopping list and the assistant fill the same draft; a patch keeps the source', async ({
    client,
    assert,
  }) => {
    const { category, product, token } = await supplierWithProduct()
    const cola = await ProductFactory.merge({ categoryId: category.id }).create()
    const created = await callTool(client, token, 'create_stock_draft', {
      items: [{ label: 'MONSTER', amount: 12, purchasePrice: 24.9 }],
    })
    await callTool(client, token, 'add_shopping_list_line', { productId: product.id, quantity: 6 })

    const completed = await callTool(client, token, 'complete_shopping_list')
    assert.isFalse(completed.isError, completed.raw)
    assert.equal(completed.data.draftId, created.data.draftId)
    assert.equal(completed.data.added, 1)
    assert.deepEqual(
      completed.data.items.map((i: any) => [i.source, i.productId]),
      [
        ['assistant', null],
        ['shopping_list', product.id],
      ]
    )

    const patched = await callTool(client, token, 'update_stock_draft', {
      draftId: created.data.draftId,
      lines: [{ index: 0, productId: cola.id }],
    })
    assert.deepEqual(
      patched.data.items.map((i: any) => i.source),
      ['assistant', 'shopping_list']
    )
  })
})
