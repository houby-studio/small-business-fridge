import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'

function appUrl(): string {
  return env.get('APP_URL') || `http://${env.get('HOST')}:${env.get('PORT')}`
}

/**
 * Serves OAuth 2.0 discovery metadata documents required by MCP clients.
 *
 * GET /.well-known/oauth-authorization-server  (RFC 8414)
 *   MCP clients check this FIRST on the server domain to discover OAuth endpoints
 *   and Dynamic Client Registration (DCR) support. Without this, Claude Web and
 *   other browser-based clients cannot complete the OAuth flow.
 *
 * GET /.well-known/oauth-protected-resource  (RFC 9728)
 *   Tells clients this resource is protected and points to OUR OWN authorization
 *   server (not Entra ID directly, since Entra ID does not support DCR).
 *
 * Entra ID JWT tokens are still accepted at /mcp for Claude Code / GitHub Copilot
 * users who use the personal API token or Entra-native flow, but Claude Web goes
 * through our own OAuth server which issues opaque API tokens after the user
 * authenticates via the existing web session / OIDC login.
 */
export default class McpOauthMetaController {
  async authorizationServer({ response }: HttpContext) {
    const base = appUrl()
    return response.header('Cache-Control', 'no-store').json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    })
  }

  async protectedResource({ response }: HttpContext) {
    const base = appUrl()
    return response.header('Cache-Control', 'no-store').json({
      resource: `${base}/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ['header'],
    })
  }
}
