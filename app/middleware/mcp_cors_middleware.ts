import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Applies permissive CORS headers to MCP-related endpoints:
 * - /mcp — the main SSE/JSON-RPC endpoint
 * - /.well-known/oauth-protected-resource — RFC 9728 PRM document
 * - /.well-known/oauth-authorization-server — RFC 8414 AS metadata document
 * - /oauth/register — Dynamic Client Registration (RFC 7591)
 * - /oauth/token — token endpoint (RFC 6749)
 *
 * All of these use Bearer token auth (not cookies), so allowing any origin does
 * not create a CSRF risk. CSRF is also exempt for /oauth/register and /oauth/token
 * via shield.ts exceptRoutes.
 *
 * This middleware must run BEFORE @adonisjs/cors so it can short-circuit OPTIONS
 * preflights before the global CORS middleware absorbs them (which would return
 * 204 with no Access-Control-Allow-Origin, causing browsers to block the request).
 */
export default class McpCorsMiddleware {
  private static readonly EXACT_PATHS = new Set([
    '/mcp',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-authorization-server',
    '/oauth/register',
    '/oauth/token',
  ])

  async handle({ request, response }: HttpContext, next: NextFn) {
    const url = request.url()
    if (!McpCorsMiddleware.EXACT_PATHS.has(url)) {
      return next()
    }

    const origin = request.header('Origin')
    if (origin) {
      response.header('Access-Control-Allow-Origin', origin)
      response.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      response.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id')
      response.header('Access-Control-Max-Age', '86400')
      // No Allow-Credentials: Bearer tokens are used, not cookies
    }

    if (request.method() === 'OPTIONS') {
      return response.status(204).send('')
    }

    return next()
  }
}
