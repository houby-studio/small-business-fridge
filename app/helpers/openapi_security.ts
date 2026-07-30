/**
 * Serve-time OpenAPI security helpers.
 *
 * The Entra ID oauth2 scheme is injected into the served spec at REQUEST time
 * (from the runtime env) rather than baked into the pre-generated swagger.json,
 * because in production the spec is generated at Docker build where the Microsoft
 * env vars are not present.
 */

/**
 * Pinned `@scalar/api-reference` CDN version.
 *
 * adonis-autoswagger's Scalar template loads the renderer from an UNVERSIONED jsDelivr
 * URL (= whatever is latest), so we pin it for reproducibility.
 *
 * Must stay >= 1.49.2 (scalar/scalar#8517, merged 2026-03-20): earlier builds OMIT
 * `client_id` from the OAuth2 token-exchange POST body for public authorization-code
 * (PKCE) clients, which Entra ID rejects — the user just sees "Failed to authorize".
 * #8517 also stops Scalar sending a Basic auth header when no client secret is set, and
 * 1.62.x additionally HIDES the client-secret input entirely for PKCE public clients (the
 * empty field older builds rendered with an "XYZ123" placeholder — never a real secret,
 * but it looked like one).
 *
 * A cosmetic phantom-duplicate-scheme glitch (see scalarAuthConfiguration) is present in
 * current Scalar whenever a scope is pre-selected — accepted as the lesser evil.
 */
export const SCALAR_PINNED_VERSION = '1.62.6'

/**
 * Pin the unversioned `@scalar/api-reference` CDN URL emitted by autoswagger to
 * SCALAR_PINNED_VERSION. Idempotent: an already-versioned URL is left untouched.
 */
export function pinScalarCdnVersion(html: string): string {
  return html.replace(
    /https:\/\/cdn\.jsdelivr\.net\/npm\/@scalar\/api-reference(?!@)/g,
    `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_PINNED_VERSION}`
  )
}

export interface EntraOAuthScheme {
  'type': 'oauth2'
  'description': string
  'flows': {
    authorizationCode: {
      authorizationUrl: string
      tokenUrl: string
      scopes: Record<string, string>
    }
  }
  'x-usePkce': string
  'x-scalar-client-id': string
}

/** The API scope exposed by the Entra app registration. */
export function entraApiScope(clientId: string): string {
  return `api://${clientId}/access_as_user`
}

/**
 * Scalar `data-configuration` that pre-drives the Entra OAuth2 flow so a user does
 * not have to paste the client id, tick the scope, or fix the token-request auth by
 * hand. Returns null when Microsoft auth is unconfigured (then Scalar just offers
 * BearerAuth). `appUrl` is the app origin used to build the /docs redirect URI that
 * must match the SPA redirect registered in Entra.
 *
 * NOTE: pre-selecting the scope (`selectedScopes`) is REQUIRED — without our API scope in
 * the request Entra hands back a token for the wrong audience and every "Try it" call 401s.
 * Any selected scope (pre-selected here OR ticked by the user at Authorize time) makes
 * Scalar draw a phantom duplicate "EntraId" entry in the Authentication dropdown
 * (scalar/scalar#8503 — still present in 1.62.x despite the issue being marked fixed). The
 * duplicate is purely cosmetic (the correct scheme is auto-selected; the authorize/token
 * requests are well-formed) and, since it reappears the moment the user selects the scope
 * themselves, unavoidable on current Scalar — so we keep the pre-selection for the better UX
 * rather than degrading it to chase a glitch we cannot actually prevent.
 */
export function scalarAuthConfiguration(
  tenantId?: string,
  clientId?: string,
  appUrl?: string
): object | null {
  if (!tenantId || !clientId) return null
  const authorizationCode: Record<string, unknown> = {
    'x-scalar-client-id': clientId,
    'x-usePkce': 'SHA-256',
    'selectedScopes': [entraApiScope(clientId)],
  }
  if (appUrl) {
    authorizationCode['x-scalar-redirect-uri'] = `${appUrl.replace(/\/+$/, '')}/docs`
  }
  return {
    authentication: {
      preferredSecurityScheme: 'EntraId',
      securitySchemes: { EntraId: { flows: { authorizationCode } } },
    },
  }
}

/**
 * autoswagger's TS interface parser can't represent `T | null` unions — it emits a
 * broken `$ref` pointing at a schema literally named "T | null", which Scalar renders
 * as an empty/garbage model. Rewrite those into proper OpenAPI 3.0 nullable schemas.
 *
 * Interfaces must use NAMED types for the base (no inline object literals, which
 * autoswagger truncates to an unrecoverable "{ id" ref). Mutates `spec`.
 */
export function normalizeNullableRefs(spec: any): void {
  const schemas = spec?.components?.schemas
  if (!schemas) return
  const PRIMITIVES = new Set(['string', 'number', 'integer', 'boolean'])

  const fix = (node: any): any => {
    if (Array.isArray(node)) return node.map(fix)
    if (!node || typeof node !== 'object') return node

    if (typeof node.$ref === 'string' && node.$ref.includes(' | null')) {
      const base = node.$ref.replace('#/components/schemas/', '').split(' | ')[0].trim()
      const rest: Record<string, any> = {}
      for (const [key, value] of Object.entries(node)) {
        if (key !== '$ref') rest[key] = value
      }
      if (PRIMITIVES.has(base)) return { ...rest, type: base, nullable: true }
      return { ...rest, nullable: true, allOf: [{ $ref: `#/components/schemas/${base}` }] }
    }

    const out: Record<string, any> = {}
    for (const [key, value] of Object.entries(node)) out[key] = fix(value)
    return out
  }

  for (const name of Object.keys(schemas)) schemas[name] = fix(schemas[name])
}

/** Builds the Entra ID oauth2 (authorization code + PKCE) scheme, or null when unconfigured. */
export function entraOAuthScheme(tenantId?: string, clientId?: string): EntraOAuthScheme | null {
  if (!tenantId || !clientId) return null
  return {
    'type': 'oauth2',
    'description':
      'Microsoft Entra ID sign-in (OAuth2 authorization code + PKCE). Requires a linked ' +
      'Microsoft account. Alternatively paste a personal API token via BearerAuth.',
    'flows': {
      authorizationCode: {
        authorizationUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
        tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        scopes: {
          [entraApiScope(clientId)]: 'Access the Small Business Fridge API on your behalf',
        },
      },
    },
    'x-usePkce': 'SHA-256',
    'x-scalar-client-id': clientId,
  }
}

/**
 * Injects the Entra scheme into `spec.components.securitySchemes` and offers it as an
 * alternative to BearerAuth on every operation that requires auth. No-op when Microsoft
 * auth is not configured. Mutates `spec`.
 */
export function applyEntraSecurity(spec: any, tenantId?: string, clientId?: string): void {
  const scheme = entraOAuthScheme(tenantId, clientId)
  if (!scheme) return

  spec.components = spec.components ?? {}
  spec.components.securitySchemes = {
    ...(spec.components.securitySchemes ?? {}),
    EntraId: scheme,
  }

  const scope = entraApiScope(clientId!)
  for (const pathItem of Object.values(spec.paths ?? {})) {
    for (const operation of Object.values((pathItem ?? {}) as Record<string, any>)) {
      const security = operation?.security
      if (!Array.isArray(security)) continue
      const requiresBearer = security.some((req: any) => req && 'BearerAuth' in req)
      const alreadyHasEntra = security.some((req: any) => req && 'EntraId' in req)
      if (requiresBearer && !alreadyHasEntra) {
        security.push({ EntraId: [scope] })
      }
    }
  }
}
