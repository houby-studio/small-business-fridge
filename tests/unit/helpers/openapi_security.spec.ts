import { test } from '@japa/runner'
import {
  entraOAuthScheme,
  applyEntraSecurity,
  entraApiScope,
  normalizeNullableRefs,
  scalarAuthConfiguration,
  pinScalarCdnVersion,
  SCALAR_PINNED_VERSION,
} from '#helpers/openapi_security'

const TENANT = '906f66d2-tenant'
const CLIENT = 'b1b0fc28-client'

test.group('openapi_security.entraOAuthScheme', () => {
  test('returns null when tenant or client id is missing', ({ assert }) => {
    assert.isNull(entraOAuthScheme(undefined, CLIENT))
    assert.isNull(entraOAuthScheme(TENANT, undefined))
    assert.isNull(entraOAuthScheme(undefined, undefined))
  })

  test('builds an oauth2 authorization-code + PKCE scheme when configured', ({ assert }) => {
    const scheme = entraOAuthScheme(TENANT, CLIENT)!
    assert.equal(scheme.type, 'oauth2')
    assert.equal(scheme['x-usePkce'], 'SHA-256')
    assert.equal(scheme['x-scalar-client-id'], CLIENT)
    const flow = scheme.flows.authorizationCode
    assert.include(flow.authorizationUrl, `/${TENANT}/oauth2/v2.0/authorize`)
    assert.include(flow.tokenUrl, `/${TENANT}/oauth2/v2.0/token`)
    assert.property(flow.scopes, entraApiScope(CLIENT))
  })
})

test.group('openapi_security.applyEntraSecurity', () => {
  const baseSpec = () => ({
    components: { securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer' } } },
    paths: {
      '/api/v1/health': { get: { security: [] } },
      '/api/v1/products': { get: { security: [{ BearerAuth: ['access'] }] } },
    },
  })

  test('is a no-op when Microsoft auth is not configured', ({ assert }) => {
    const spec = baseSpec()
    applyEntraSecurity(spec, undefined, undefined)
    assert.notProperty(spec.components.securitySchemes, 'EntraId')
    assert.deepEqual(spec.paths['/api/v1/products'].get.security, [{ BearerAuth: ['access'] }])
  })

  test('injects the scheme and offers it on auth-required operations', ({ assert }) => {
    const spec = baseSpec()
    applyEntraSecurity(spec, TENANT, CLIENT)

    assert.property(spec.components.securitySchemes, 'EntraId')
    // Offered as an alternative on the protected operation...
    assert.deepInclude(spec.paths['/api/v1/products'].get.security, {
      EntraId: [entraApiScope(CLIENT)],
    })
    // ...but not added to the public (no-auth) operation.
    assert.deepEqual(spec.paths['/api/v1/health'].get.security, [])
  })

  test('does not add EntraId twice', ({ assert }) => {
    const spec = baseSpec()
    applyEntraSecurity(spec, TENANT, CLIENT)
    applyEntraSecurity(spec, TENANT, CLIENT)
    const entraEntries = spec.paths['/api/v1/products'].get.security.filter(
      (req: Record<string, unknown>) => 'EntraId' in req
    )
    assert.lengthOf(entraEntries, 1)
  })
})

test.group('openapi_security.normalizeNullableRefs', () => {
  const wrap = (prop: unknown) => ({
    components: { schemas: { X: { type: 'object', properties: { p: prop } } } },
  })

  test('rewrites a primitive `| null` ref to a nullable typed schema', ({ assert }) => {
    const spec = wrap({ nullable: false, $ref: '#/components/schemas/string | null' })
    normalizeNullableRefs(spec)
    assert.deepEqual(spec.components.schemas.X.properties.p, { type: 'string', nullable: true })
  })

  test('rewrites a named `| null` ref to a nullable allOf', ({ assert }) => {
    const spec = wrap({ $ref: '#/components/schemas/CategoryRef | null' })
    normalizeNullableRefs(spec)
    assert.deepEqual(spec.components.schemas.X.properties.p, {
      nullable: true,
      allOf: [{ $ref: '#/components/schemas/CategoryRef' }],
    })
  })

  test('leaves a clean ref untouched', ({ assert }) => {
    const spec = wrap({ $ref: '#/components/schemas/AllergenRef' })
    normalizeNullableRefs(spec)
    assert.deepEqual(spec.components.schemas.X.properties.p, {
      $ref: '#/components/schemas/AllergenRef',
    })
  })
})

test.group('openapi_security.scalarAuthConfiguration', () => {
  test('returns null when Microsoft auth is not configured', ({ assert }) => {
    assert.isNull(scalarAuthConfiguration(undefined, CLIENT, 'https://app.test'))
    assert.isNull(scalarAuthConfiguration(TENANT, undefined, 'https://app.test'))
  })

  test('prefills client id, PKCE, scope and the /docs redirect uri', ({ assert }) => {
    const cfg = scalarAuthConfiguration(TENANT, CLIENT, 'https://app.test/') as any
    const flow = cfg.authentication.securitySchemes.EntraId.flows.authorizationCode
    assert.equal(cfg.authentication.preferredSecurityScheme, 'EntraId')
    assert.equal(flow['x-scalar-client-id'], CLIENT)
    assert.equal(flow['x-usePkce'], 'SHA-256')
    // The scope is pre-selected so the user does not have to tick it by hand (and so the
    // issued token targets our API audience rather than a default one). This trips a
    // cosmetic phantom-duplicate-scheme glitch in Scalar (scalar/scalar#8503) that is
    // unavoidable whenever any scope is selected — accepted; see SCALAR_PINNED_VERSION.
    assert.deepEqual(flow.selectedScopes, [entraApiScope(CLIENT)])
    // Trailing slash on appUrl is trimmed before appending /docs.
    assert.equal(flow['x-scalar-redirect-uri'], 'https://app.test/docs')
  })

  test('omits the redirect uri when no app url is provided', ({ assert }) => {
    const cfg = scalarAuthConfiguration(TENANT, CLIENT) as any
    const flow = cfg.authentication.securitySchemes.EntraId.flows.authorizationCode
    assert.notProperty(flow, 'x-scalar-redirect-uri')
  })
})

test.group('openapi_security.pinScalarCdnVersion', () => {
  const cdn = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference'

  test('pins the unversioned autoswagger CDN url to the known-good version', ({ assert }) => {
    const html = `<script id="api-reference" data-url="/docs/openapi.json"></script><script src="${cdn}"></script>`
    const pinned = pinScalarCdnVersion(html)
    assert.include(pinned, `${cdn}@${SCALAR_PINNED_VERSION}"`)
    assert.notInclude(pinned, `${cdn}"`)
  })

  test('is idempotent — leaves an already-versioned url untouched', ({ assert }) => {
    const html = `<script src="${cdn}@${SCALAR_PINNED_VERSION}"></script>`
    assert.equal(pinScalarCdnVersion(html), html)
  })
})
