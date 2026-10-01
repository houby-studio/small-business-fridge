import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { ProductFactory } from '#database/factories/product_factory'
import Allergen from '#models/allergen'
import productAiConfig from '#config/product_ai'
import productImagesConfig from '#config/product_images'
import { clearOpenFoodFactsCache } from '#services/product_images/open_food_facts'
import { clearProductAiTokenCache } from '#services/product_ai/azure_openai_client'
import { startStubServer, type StubServer } from '#tests/utils/product_image_fixtures'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('product_allergen').delete()
  await db.from('products').delete()
  await db.from('allergens').delete()
  await db.from('categories').delete()
  await db.from('auth_access_tokens').delete()
  await db.from('users').delete()
}

/** Stands in for Azure OpenAI: answers every chat completion with `content`. */
function aiStub(content: Record<string, unknown>, status = 200): Promise<StubServer> {
  return startStubServer((req, _body, res) => {
    if (req.url?.includes('/oauth2/v2.0/token')) {
      res
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ access_token: 'entra-token', expires_in: 3600 }))
      return
    }
    res
      .writeHead(status, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }))
  })
}

function offStub(): Promise<StubServer> {
  return startStubServer((_req, _body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        status: 1,
        product: {
          product_name_cs: 'Snickers',
          quantity: '50 g',
          categories: 'Candy chocolate bars',
          ingredients_text: 'milk chocolate, peanuts',
          allergens_tags: ['en:milk', 'en:peanuts'],
        },
      })
    )
  })
}

function bodyOf(request: { body: Buffer }) {
  return JSON.parse(request.body.toString()) as {
    messages: { role: string; content: string }[]
    response_format: { type: string }
  }
}

test.group('Web Supplier - product suggestions', (group) => {
  const originalAi = { ...productAiConfig }
  const originalOff = { ...productImagesConfig.openFoodFacts }
  let servers: StubServer[] = []

  group.each.setup(cleanAll)
  group.each.teardown(async () => {
    Object.assign(productAiConfig, originalAi)
    Object.assign(productImagesConfig.openFoodFacts, originalOff)
    clearOpenFoodFactsCache()
    clearProductAiTokenCache()
    await Promise.all(servers.map((s) => s.close()))
    servers = []
    await cleanAll()
  })

  async function setup(ai: StubServer | null, auth: 'key' | 'entra' = 'key') {
    const off = await offStub()
    servers.push(off)
    productImagesConfig.openFoodFacts.baseUrl = off.url
    Object.assign(productAiConfig, {
      endpoint: ai ? ai.url : '',
      deployment: 'gpt-test',
      apiKey: auth === 'key' ? 'secret-key' : '',
      tenantId: auth === 'entra' ? 'tenant' : '',
      clientId: auth === 'entra' ? 'client' : '',
      clientSecret: auth === 'entra' ? 'client-secret' : '',
      bearerToken: '',
      authorityUrl: ai ? ai.url : originalAi.authorityUrl,
    })
    const category = await CategoryFactory.merge({ name: 'Sladké' }).create()
    const milk = await Allergen.create({ name: 'Mléko', isDisabled: false })
    const peanuts = await Allergen.create({ name: 'Arašídy', isDisabled: false })
    await Allergen.create({ name: 'Lepek (obiloviny)', isDisabled: false })
    const supplier = await UserFactory.apply('supplier').create()
    return { category, milk, peanuts, supplier }
  }

  test('suggests a category with AI and allergens from Open Food Facts', async ({
    client,
    assert,
  }) => {
    const { category, milk, peanuts, supplier } = await setup(null)
    const ai = await aiStub({ categoryId: category.id })
    servers.push(ai)
    Object.assign(productAiConfig, { endpoint: ai.url })

    const response = await client
      .post('/supplier/products/suggest')
      .loginAs(supplier)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ field: 'classification', name: 'Snickers 50 g', barcode: '5900951311505' })

    response.assertStatus(200)
    assert.equal(response.body().categoryId, category.id)
    assert.deepEqual(
      response.body().allergenIds,
      [milk.id, peanuts.id].sort((a, b) => a - b)
    )
    assert.equal(response.body().allergensFrom, 'openfoodfacts')

    const request = ai.requests[0]
    assert.include(request.url, '/openai/deployments/gpt-test/chat/completions')
    assert.equal(request.headers['api-key'], 'secret-key')
    const sent = bodyOf(request)
    assert.equal(sent.response_format.type, 'json_schema')
    assert.include(sent.messages[1].content, `${category.id}: Sladké`)
    // Allergens are never left to the model.
    assert.notInclude(sent.messages[1].content, 'Mléko')
  })

  test('ignores a category id the model made up', async ({ client, assert }) => {
    const { supplier } = await setup(null)
    const ai = await aiStub({ categoryId: 99999 })
    servers.push(ai)
    Object.assign(productAiConfig, { endpoint: ai.url })
    const response = await client
      .post('/supplier/products/suggest')
      .loginAs(supplier)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ field: 'classification', name: 'Snickers', barcode: '5900951311505' })
    response.assertStatus(200)
    assert.isNull(response.body().categoryId)
  })

  test('without AI still takes the allergens from Open Food Facts', async ({ client, assert }) => {
    const { milk, peanuts, supplier } = await setup(null)
    const response = await client
      .post('/supplier/products/suggest')
      .loginAs(supplier)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ field: 'classification', name: 'Snickers', barcode: '5900951311505' })
    response.assertStatus(200)
    assert.isNull(response.body().categoryId)
    assert.deepEqual(
      response.body().allergenIds,
      [milk.id, peanuts.id].sort((a, b) => a - b)
    )
  })

  test('writes a description in the catalogue tone, with an Entra token', async ({
    client,
    assert,
  }) => {
    const { category, supplier } = await setup(null, 'entra')
    const ai = await aiStub({ description: 'Tyčinka, která tě podrží až do oběda.' })
    servers.push(ai)
    Object.assign(productAiConfig, { endpoint: ai.url, authorityUrl: ai.url })
    await ProductFactory.merge({
      categoryId: category.id,
      displayName: 'Bounty',
      description: 'Kokosový ráj v kanceláři, palmy si domysli sám.',
    }).create()

    const response = await client
      .post('/supplier/products/suggest')
      .loginAs(supplier)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({
        field: 'description',
        name: 'Snickers 50 g',
        barcode: '5900951311505',
        currentDescription: 'Starý popis',
      })

    response.assertStatus(200)
    assert.equal(response.body().description, 'Tyčinka, která tě podrží až do oběda.')

    const token = ai.requests.find((r) => r.url.includes('/oauth2/v2.0/token'))!
    assert.include(token.url, '/tenant/oauth2/v2.0/token')
    assert.include(token.body.toString(), 'grant_type=client_credentials')
    const chat = ai.requests.find((r) => r.url.includes('/chat/completions'))!
    assert.equal(chat.headers.authorization, 'Bearer entra-token')
    const prompt = bodyOf(chat).messages[1].content
    assert.include(prompt, 'Bounty: Kokosový ráj v kanceláři')
    assert.include(prompt, 'Složení: milk chocolate, peanuts')
    assert.include(prompt, 'napiš jiný): Starý popis')
  })

  test('says so when AI is off or fails', async ({ client, assert }) => {
    const { supplier } = await setup(null)
    const off = await client
      .post('/supplier/products/suggest')
      .loginAs(supplier)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ field: 'description', name: 'Snickers' })
    off.assertStatus(422)
    assert.equal(off.body().error, 'product_ai_unavailable')

    const broken = await aiStub({}, 500)
    servers.push(broken)
    Object.assign(productAiConfig, { endpoint: broken.url })
    const failed = await client
      .post('/supplier/products/suggest')
      .loginAs(supplier)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ field: 'description', name: 'Snickers' })
    failed.assertStatus(422)
    assert.equal(failed.body().error, 'product_ai_failed')
  })

  test('validates the request and is for suppliers only', async ({ client }) => {
    const { supplier } = await setup(null)
    const invalid = await client
      .post('/supplier/products/suggest')
      .loginAs(supplier)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ field: 'poem', name: '' })
    invalid.assertStatus(422)

    const customer = await UserFactory.create()
    const denied = await client
      .post('/supplier/products/suggest')
      .loginAs(customer)
      .withCsrfToken()
      .json({ field: 'description', name: 'Snickers' })
      .redirects(0)
    denied.assertStatus(302)
  })

  test('the product forms learn whether AI is available', async ({ client, assert }) => {
    const { supplier } = await setup(null)
    const off = await client
      .get('/supplier/products/new')
      .loginAs(supplier)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')
    assert.isFalse(off.body().props.aiSuggestions)

    Object.assign(productAiConfig, { endpoint: 'https://ai.example', apiKey: 'k' })
    const on = await client
      .get('/supplier/products/new')
      .loginAs(supplier)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')
    assert.isTrue(on.body().props.aiSuggestions)
  })
})
