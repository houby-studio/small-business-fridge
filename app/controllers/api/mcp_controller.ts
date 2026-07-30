import type { HttpContext } from '@adonisjs/core/http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer, type McpLoggingContext } from '#mcp/server'
import { entraIdJwtVerifier } from '#services/entra_id_jwt_verifier'
import { looksLikeJwt } from '#utils/bearer_token'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import type User from '#models/user'

function appUrl(): string {
  return env.get('APP_URL') || `http://${env.get('HOST')}:${env.get('PORT')}`
}

/**
 * MCP (Model Context Protocol) HTTP controller.
 *
 * Handles the Streamable HTTP transport at /mcp.
 *
 * Two auth paths are supported in priority order:
 *
 * 1. Entra ID OAuth (recommended for AI tools like Claude Code / Copilot)
 *    The tool performs an OAuth 2.1 PKCE flow against Microsoft Entra ID and
 *    presents the resulting access token as a Bearer token. The token is
 *    verified locally via JWKS and resolved to a local user through
 *    UserAuthIdentity. Requires the user to have previously linked their
 *    Microsoft account (Profile → Security → Microsoft).
 *
 * 2. Personal API token (fallback for local-only accounts or automated use)
 *    Opaque tokens issued by the app itself (Profile → API Tokens). These are
 *    looked up in the database via the `api` auth guard.
 *
 * Unauthenticated requests receive 401 with a WWW-Authenticate header pointing
 * to the Protected Resource Metadata document (RFC 9728), which AI tools use
 * to discover the authorization server.
 *
 * Usage with Claude Desktop (claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "fridge": {
 *       "url": "https://your-app.example.com/mcp"
 *     }
 *   }
 * }
 * Claude will follow the OAuth flow automatically.
 *
 * Usage with a personal API token (local-only accounts):
 * {
 *   "mcpServers": {
 *     "fridge": {
 *       "url": "https://your-app.example.com/mcp",
 *       "headers": { "Authorization": "Bearer <your-personal-api-token>" }
 *     }
 *   }
 * }
 */
export default class McpController {
  async handle({ request, response, auth }: HttpContext) {
    const authHeader = request.header('Authorization')

    logger.debug({
      type: 'mcp_request',
      method: request.method(),
      hasAuth: !!authHeader,
      authType: authHeader?.startsWith('Bearer ') ? 'bearer' : authHeader ? 'other' : 'none',
      acceptHeader: request.header('accept'),
      contentType: request.header('content-type'),
      ua: request.header('user-agent'),
      reqId: request.id(),
    })

    const user = await this.resolveUser(authHeader, auth)

    if (!user) {
      const resourceMetadataUrl = `${appUrl()}/.well-known/oauth-protected-resource`
      response.header('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}"`)

      logger.info({
        type: 'mcp_auth_failed',
        method: request.method(),
        hasAuthHeader: !!authHeader,
        reqId: request.id(),
      })

      return response.status(401).json({
        error: 'unauthorized',
        error_description:
          'Bearer token required. Use an Entra ID OAuth token or a personal API token.',
      })
    }

    // Kiosk devices are shared terminals — they must not expose MCP access,
    // and disabled accounts are rejected outright.
    if (user.isKiosk || user.isDisabled) {
      logger.info({
        type: 'mcp_auth_rejected',
        reason: user.isKiosk ? 'kiosk_user' : 'disabled_user',
        userId: user.id,
        reqId: request.id(),
      })
      return response.status(403).json({
        error: 'forbidden',
        error_description: 'This account cannot access the MCP endpoint.',
      })
    }

    logger.debug({
      type: 'mcp_auth_ok',
      userId: user.id,
      reqId: request.id(),
    })

    const loggingCtx: McpLoggingContext = {
      userId: user.id,
      userAgent: request.header('user-agent') ?? null,
      msCorrelationId:
        request.header('x-ms-correlation-id') ?? request.header('client-request-id') ?? null,
    }
    const server = createMcpServer(user, loggingCtx)

    const transport = new StreamableHTTPServerTransport({
      // Stateless mode: no persistent sessions needed.
      // Each request is fully self-contained with Bearer auth.
      sessionIdGenerator: undefined,
      // Do NOT set enableJsonResponse — let the SDK respond with SSE or JSON
      // based on the client's Accept header. Copilot Studio requires SSE streaming
      // (text/event-stream) and will error if it receives a plain JSON response.
    })

    transport.onerror = (err) => {
      logger.warn({
        type: 'mcp_transport_error',
        err: err.message,
        userId: user.id,
        reqId: request.id(),
      })
    }

    await server.connect(transport)

    // Pass the already-parsed body from AdonisJS body parser.
    // The transport uses this directly without re-reading the stream.
    const body = request.body()

    // Log the JSON-RPC method(s) for debugging (info level so it's visible by default).
    if (body && typeof body === 'object') {
      const msgs = Array.isArray(body) ? body : [body]
      const methods = msgs
        .filter((m: Record<string, unknown>) => typeof m?.method === 'string')
        .map((m: Record<string, unknown>) => m.method as string)
      if (methods.length > 0) {
        logger.info({
          type: 'mcp_call',
          methods,
          userId: user.id,
          reqId: request.id(),
        })
      }
    }

    try {
      await transport.handleRequest(request.request, response.response, body)
    } catch (err) {
      logger.error({
        type: 'mcp_transport_error',
        err: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        userId: user.id,
        method: request.method(),
        reqId: request.id(),
      })
      throw err
    }
  }

  /**
   * Resolves the Bearer token to a User using two strategies:
   *
   * - JWT token (3 dot-separated segments): verified as an Entra ID access token
   *   via JWKS and resolved through UserAuthIdentity.
   * - Opaque token: looked up in the database via the api auth guard.
   *
   * Returns null when no valid token is provided or the token cannot be resolved.
   */
  private async resolveUser(
    authHeader: string | undefined,
    auth: HttpContext['auth']
  ): Promise<User | null> {
    if (!authHeader?.startsWith('Bearer ')) return null
    const token = authHeader.slice(7)

    if (looksLikeJwt(token)) {
      return entraIdJwtVerifier.resolveUser(token)
    }

    try {
      await auth.use('api').authenticate()
      return auth.use('api').user ?? null
    } catch {
      return null
    }
  }
}
