import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { store as throttleStore } from '#middleware/throttle_middleware'

const cleanAll = async () => {
  await db.from('auth_access_tokens').delete()
  await db.from('users').delete()
}

/**
 * Collects every `#/components/schemas/<name>` reference found anywhere inside a value.
 * Mirrors the pruning logic in start/routes.ts so the test verifies the invariant
 * rather than a hard-coded schema list.
 */
function collectSchemaRefs(value: unknown, into: Set<string>) {
  const json = JSON.stringify(value) ?? ''
  const re = /#\/components\/schemas\/([A-Za-z0-9_.-]+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(json)) !== null) {
    into.add(match[1])
  }
}

/**
 * Returns the set of dot-paths present in an object/array structure, ignoring array
 * indices (arrays collapse to `[]`). Used to compare a documented example's shape
 * against a real response so drift (added/removed fields) fails the test.
 */
function keyPaths(value: unknown, prefix = ''): Set<string> {
  const out = new Set<string>()
  if (Array.isArray(value)) {
    if (value.length > 0) {
      for (const p of keyPaths(value[0], `${prefix}[]`)) out.add(p)
    }
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key
      out.add(path)
      for (const p of keyPaths(nested, path)) out.add(p)
    }
  }
  return out
}

test.group('OpenAPI docs contract', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(cleanAll)

  test('GET /docs/openapi.json requires an authenticated session', async ({ client, assert }) => {
    const response = await client.get('/docs/openapi.json').redirects(0)
    assert.notEqual(response.status(), 200)
    assert.include([401, 302], response.status())
  })

  test('GET /docs requires an authenticated session', async ({ client, assert }) => {
    const response = await client.get('/docs').redirects(0)
    assert.notEqual(response.status(), 200)
    assert.include([401, 302], response.status())
  })

  test('GET /docs renders the Scalar reference for an authenticated user', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()
    const response = await client.get('/docs').loginAs(user)
    response.assertStatus(200)
    // Scalar's renderer loads the @scalar/api-reference bundle and points at the spec.
    assert.include(response.text(), '@scalar/api-reference')
    assert.include(response.text(), '/docs/openapi.json')
  })

  test('served spec exposes only /api/v1 paths', async ({ client, assert }) => {
    const user = await UserFactory.create()
    const response = await client.get('/docs/openapi.json').loginAs(user)
    response.assertStatus(200)

    const spec = response.body()
    const paths = Object.keys(spec.paths ?? {})
    assert.isAbove(paths.length, 0)
    for (const path of paths) {
      assert.isTrue(path.startsWith('/api/v1'), `path ${path} is not under /api/v1`)
    }
  })

  test('served spec prunes schemas to only those reachable from the paths', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()
    const response = await client.get('/docs/openapi.json').loginAs(user)
    response.assertStatus(200)

    const spec = response.body()
    const schemas = spec.components?.schemas ?? {}

    // Recompute the transitive closure of schema references from the retained paths.
    const reachable = new Set<string>()
    collectSchemaRefs(spec.paths, reachable)
    const queue = [...reachable]
    while (queue.length > 0) {
      const name = queue.shift()!
      const nested = new Set<string>()
      collectSchemaRefs(schemas[name], nested)
      for (const ref of nested) {
        if (!reachable.has(ref)) {
          reachable.add(ref)
          queue.push(ref)
        }
      }
    }

    // Every remaining schema must be reachable; nothing unreferenced should survive.
    const remaining = Object.keys(schemas).sort()
    const expected = [...reachable].filter((name) => name in schemas).sort()
    assert.deepEqual(remaining, expected)

    // Sanity: known Inertia-only schemas must NOT leak into the API spec.
    for (const leaked of ['loginValidator', 'updateProfileValidator', 'User', 'Invoice']) {
      assert.notProperty(schemas, leaked, `schema ${leaked} should have been pruned`)
    }
  })

  test('served spec declares the BearerAuth security scheme', async ({ client, assert }) => {
    const user = await UserFactory.create()
    const response = await client.get('/docs/openapi.json').loginAs(user)
    response.assertStatus(200)

    const schemes = response.body().components?.securitySchemes ?? {}
    assert.property(schemes, 'BearerAuth')
    assert.equal(schemes.BearerAuth.scheme, 'bearer')
    // autoswagger's unused defaults are stripped — the API only accepts Bearer tokens.
    assert.notProperty(schemes, 'BasicAuth')
    assert.notProperty(schemes, 'ApiKeyAuth')
  })

  test('response bodies reference named DTO schemas (discoverability)', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()
    const response = await client.get('/docs/openapi.json').loginAs(user)
    response.assertStatus(200)

    const spec = response.body()
    const schemas = spec.components?.schemas ?? {}
    for (const name of [
      'ProductResponse',
      'ProductListResponse',
      'OrderResponse',
      'OrderListResponse',
      'CustomerInsightsResponse',
      'TokenResponse',
    ]) {
      assert.property(schemas, name, `named schema ${name} should be present`)
    }

    // Named DTOs are camelCase, matching the real serialized responses.
    assert.property(schemas.ProductResponse.properties, 'displayName')
    assert.notProperty(schemas.ProductResponse.properties, 'display_name')

    // No dangling `T | null` refs survive — autoswagger's broken unions are normalized.
    assert.notInclude(JSON.stringify(spec), ' | null')
    // Nullable fields render as proper OpenAPI nullable schemas.
    assert.deepEqual(schemas.ProductResponse.properties.description, {
      type: 'string',
      nullable: true,
    })
    assert.isTrue(schemas.OrderWithDeliveryResponse.properties.delivery.nullable)
    assert.property(schemas.OrderWithDeliveryResponse.properties.delivery, 'allOf')

    const productsRef =
      spec.paths?.['/api/v1/products']?.get?.responses?.['200']?.content?.['application/json']
        ?.schema?.$ref
    assert.equal(productsRef, '#/components/schemas/ProductListResponse')

    // Request bodies use a clean hand-written DTO, NOT the VineJS validator schema.
    const orderReqRef =
      spec.paths?.['/api/v1/orders']?.post?.requestBody?.content?.['application/json']?.schema?.$ref
    assert.equal(orderReqRef, '#/components/schemas/OrderCreateRequest')
    assert.notProperty(schemas, 'apiOrderValidator', 'validator schema should be pruned')
  })

  test('real /api/v1/health response matches its documented example (drift guard)', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()
    const specResponse = await client.get('/docs/openapi.json').loginAs(user)
    specResponse.assertStatus(200)

    const example =
      specResponse.body().paths?.['/api/v1/health']?.get?.responses?.['200']?.content?.[
        'application/json'
      ]?.example
    assert.exists(example, 'health 200 example missing from spec')

    const health = await client.get('/api/v1/health')
    health.assertStatus(200)

    const documented = [...keyPaths(example)].sort()
    const actual = [...keyPaths(health.body())].sort()
    assert.deepEqual(actual, documented)
  })
})
