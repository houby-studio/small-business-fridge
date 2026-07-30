import type { HttpContext } from '@adonisjs/core/http'
import { randomUUID } from 'node:crypto'
import McpOauthClient from '#models/mcp_oauth_client'
import logger from '@adonisjs/core/services/logger'

/**
 * POST /oauth/register — OAuth 2.0 Dynamic Client Registration (RFC 7591).
 *
 * Claude Web calls this to register itself as an OAuth client before starting
 * the authorization code flow. We store the client ID and its redirect URIs.
 * No client secret is issued — this is a public client (PKCE only).
 *
 * Only HTTPS or loopback redirect URIs are accepted.
 */
export default class McpOauthRegisterController {
  async store({ request, response }: HttpContext) {
    const body = request.body() as Record<string, unknown>

    const clientName =
      typeof body['client_name'] === 'string' ? body['client_name'].slice(0, 128) : 'MCP Client'

    const rawRedirectUris = body['redirect_uris']
    if (!Array.isArray(rawRedirectUris) || rawRedirectUris.length === 0) {
      return response.status(400).json({
        error: 'invalid_client_metadata',
        error_description: 'redirect_uris is required and must be a non-empty array',
      })
    }

    const redirectUris: string[] = []
    for (const uri of rawRedirectUris) {
      if (typeof uri !== 'string') {
        return response.status(400).json({
          error: 'invalid_client_metadata',
          error_description: 'All redirect_uris must be strings',
        })
      }
      if (!this.isAllowedRedirectUri(uri)) {
        return response.status(400).json({
          error: 'invalid_redirect_uri',
          error_description: `redirect_uri must be HTTPS or loopback: ${uri}`,
        })
      }
      redirectUris.push(uri)
    }

    const grantTypes =
      Array.isArray(body['grant_types']) && body['grant_types'].every((g) => typeof g === 'string')
        ? (body['grant_types'] as string[])
        : ['authorization_code']

    const clientId = randomUUID()
    await McpOauthClient.create({
      clientId,
      clientName,
      redirectUrisRaw: JSON.stringify(redirectUris),
      grantTypesRaw: JSON.stringify(grantTypes),
    })

    logger.info({ type: 'mcp_oauth_register', clientId, clientName })

    return response.status(201).json({
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: grantTypes,
      token_endpoint_auth_method: 'none',
    })
  }

  private isAllowedRedirectUri(uri: string): boolean {
    try {
      const u = new URL(uri)
      if (u.protocol === 'https:') return true
      if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
        return true
      }
      // Allow specific safe custom URI schemes used by native/desktop OAuth clients.
      // Do NOT use a generic "not http" check — that would allow javascript: etc.
      const safeCustomSchemes = ['claude:', 'vscode:', 'vscode-insiders:', 'cursor:']
      if (safeCustomSchemes.includes(u.protocol)) return true
      return false
    } catch {
      return false
    }
  }
}
