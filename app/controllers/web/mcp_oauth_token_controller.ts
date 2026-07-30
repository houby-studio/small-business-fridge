import type { HttpContext } from '@adonisjs/core/http'
import { createHash } from 'node:crypto'
import McpOauthCode from '#models/mcp_oauth_code'
import User from '#models/user'
import logger from '@adonisjs/core/services/logger'

/**
 * POST /oauth/token — OAuth 2.1 Token Endpoint.
 *
 * Accepts an authorization code + PKCE code_verifier, verifies them, and
 * issues an opaque access token using User.accessTokens (the same mechanism
 * as personal API tokens). The issued token is accepted at /mcp via the
 * existing API token auth guard.
 */
export default class McpOauthTokenController {
  async store({ request, response }: HttpContext) {
    const body = request.body() as Record<string, unknown>

    const grantType = body['grant_type']
    if (grantType !== 'authorization_code') {
      return response.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'Only authorization_code is supported',
      })
    }

    const code = typeof body['code'] === 'string' ? body['code'] : null
    const codeVerifier = typeof body['code_verifier'] === 'string' ? body['code_verifier'] : null
    const redirectUri = typeof body['redirect_uri'] === 'string' ? body['redirect_uri'] : null
    const clientId = typeof body['client_id'] === 'string' ? body['client_id'] : null

    if (!code || !codeVerifier || !redirectUri || !clientId) {
      return response.status(400).json({
        error: 'invalid_request',
        error_description: 'code, code_verifier, redirect_uri and client_id are required',
      })
    }

    const authCode = await McpOauthCode.find(code)

    if (!authCode) {
      return response
        .status(400)
        .json({ error: 'invalid_grant', error_description: 'Unknown code' })
    }

    if (authCode.used) {
      logger.warn({ type: 'mcp_oauth_code_reuse', code })
      return response
        .status(400)
        .json({ error: 'invalid_grant', error_description: 'Code already used' })
    }

    if (authCode.isExpired) {
      return response
        .status(400)
        .json({ error: 'invalid_grant', error_description: 'Code expired' })
    }

    if (authCode.clientId !== clientId) {
      return response
        .status(400)
        .json({ error: 'invalid_grant', error_description: 'client_id mismatch' })
    }

    if (authCode.redirectUri !== redirectUri) {
      return response
        .status(400)
        .json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' })
    }

    // PKCE S256: SHA-256(code_verifier) encoded as base64url must match stored code_challenge
    const computedChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

    if (computedChallenge !== authCode.codeChallenge) {
      logger.warn({ type: 'mcp_oauth_pkce_fail', clientId })
      return response
        .status(400)
        .json({ error: 'invalid_grant', error_description: 'code_verifier mismatch' })
    }

    // Mark the code as used (single-use)
    authCode.used = true
    await authCode.save()

    const user = await User.find(authCode.userId)
    if (!user) {
      return response
        .status(400)
        .json({ error: 'invalid_grant', error_description: 'User not found' })
    }

    const token = await User.accessTokens.create(user, ['*'], {
      name: `MCP OAuth (${authCode.clientId.slice(0, 8)})`,
      // No expiry — Claude Web would need a manual re-login every month otherwise,
      // since the web session (7d) expires before the token (30d) does.
      // Users can revoke from Profile → API Tokens at any time.
    })

    logger.info({ type: 'mcp_oauth_token_issued', clientId, userId: user.id })

    return response.header('Cache-Control', 'no-store').json({
      access_token: token.value!.release(),
      token_type: 'bearer',
      // expires_in omitted — token does not expire; client should treat as long-lived
    })
  }
}
