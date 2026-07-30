import type { HttpContext } from '@adonisjs/core/http'
import { randomBytes } from 'node:crypto'
import McpOauthClient from '#models/mcp_oauth_client'
import McpOauthCode from '#models/mcp_oauth_code'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'

const SESSION_KEY = 'mcpOauthPendingParams'

/**
 * GET /oauth/authorize — OAuth 2.1 Authorization Endpoint.
 *
 * Flow:
 * 1. Validate client_id, redirect_uri, code_challenge (PKCE S256 required).
 * 2. If user is NOT logged in via web session:
 *    - Store all OAuth params in session.
 *    - Redirect to /login with ?returnTo=/oauth/authorize (params re-read from session).
 * 3. If user IS logged in:
 *    - Issue a short-lived authorization code.
 *    - Redirect to redirect_uri?code=...&state=...
 */
export default class McpOauthAuthorizeController {
  async show({ request, response, auth, session }: HttpContext) {
    const {
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: ccm,
      state,
      response_type: responseType,
    } = request.qs() as Record<string, string>

    // If params missing, we might be returning from login — check session
    const isReturnFromLogin = !clientId && session.has(SESSION_KEY)
    const params = isReturnFromLogin ? (session.pull(SESSION_KEY) as Record<string, string>) : null

    const effectiveClientId = clientId ?? params?.client_id
    const effectiveRedirectUri = redirectUri ?? params?.redirect_uri
    const effectiveCodeChallenge = codeChallenge ?? params?.code_challenge
    const effectiveCcm = ccm ?? params?.code_challenge_method
    const effectiveState = state ?? params?.state
    const effectiveResponseType = responseType ?? params?.response_type

    if (!effectiveClientId || !effectiveRedirectUri || !effectiveCodeChallenge) {
      return response
        .status(400)
        .send('Missing required parameters: client_id, redirect_uri, code_challenge')
    }

    if (effectiveResponseType !== 'code') {
      return response.status(400).send('response_type must be "code"')
    }

    if (effectiveCcm && effectiveCcm !== 'S256') {
      return response.status(400).send('code_challenge_method must be S256')
    }

    const client = await McpOauthClient.find(effectiveClientId)
    if (!client) {
      return response.status(400).send('Unknown client_id')
    }

    if (!client.redirectUris.includes(effectiveRedirectUri)) {
      return response.status(400).send('redirect_uri not registered for this client')
    }

    // Not authenticated — stash params in session and send to login
    const user = await auth.use('web').check()
    if (!user) {
      session.put(SESSION_KEY, {
        client_id: effectiveClientId,
        redirect_uri: effectiveRedirectUri,
        code_challenge: effectiveCodeChallenge,
        code_challenge_method: effectiveCcm ?? 'S256',
        state: effectiveState,
        response_type: effectiveResponseType,
      })
      return response.redirect('/login?returnTo=/oauth/authorize')
    }

    const authUser = auth.use('web').user!
    const code = randomBytes(32).toString('hex')

    await McpOauthCode.create({
      code,
      clientId: effectiveClientId,
      userId: authUser.id,
      redirectUri: effectiveRedirectUri,
      codeChallenge: effectiveCodeChallenge,
      used: false,
      expiresAt: DateTime.now().plus({ minutes: 5 }),
    })

    logger.info({ type: 'mcp_oauth_code_issued', clientId: effectiveClientId, userId: authUser.id })

    const redirectUrl = new URL(effectiveRedirectUri)
    redirectUrl.searchParams.set('code', code)
    if (effectiveState) redirectUrl.searchParams.set('state', effectiveState)

    return response.redirect(redirectUrl.toString())
  }
}
