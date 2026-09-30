import type { HttpContext } from '@adonisjs/core/http'
import { randomBytes } from 'node:crypto'
import McpOauthClient from '#models/mcp_oauth_client'
import McpOauthCode from '#models/mcp_oauth_code'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'

const SESSION_KEY = 'mcpOauthPendingParams'
/** Validated request waiting for the user's decision on the consent page. */
const CONSENT_KEY = 'mcpOauthConsent'

interface ConsentRequest {
  clientId: string
  clientName: string
  redirectUri: string
  codeChallenge: string
  state?: string
  userId: number
}

/**
 * OAuth 2.1 Authorization Endpoint.
 *
 * GET /oauth/authorize
 * 1. Validate client_id, redirect_uri, code_challenge (PKCE S256 required).
 * 2. If user is NOT logged in via web session:
 *    - Store all OAuth params in session.
 *    - Redirect to /login with ?returnTo=/oauth/authorize (params re-read from session).
 * 3. If user IS logged in: show a consent page naming the client and where it redirects.
 *    Nothing is issued on a GET — clients register themselves, so a link alone must never
 *    be enough to hand a long-lived token to whoever controls the redirect URI.
 *
 * POST /oauth/authorize (CSRF-protected) — the user's decision. Parameters come from the
 * session, never from the form, so they cannot be swapped between showing and approving.
 * Refused while an admin impersonates: a token minted then would outlive the impersonation
 * and carry the target's identity.
 */
export default class McpOauthAuthorizeController {
  async show({ request, response, auth, session, inertia }: HttpContext) {
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

    if (session.has('__impersonation')) {
      response.status(403)
      return inertia.render('auth/oauth_consent', { blocked: 'impersonating' })
    }

    const authUser = auth.use('web').user!
    const clientName = client.clientName || effectiveClientId
    const consent: ConsentRequest = {
      clientId: effectiveClientId,
      clientName,
      redirectUri: effectiveRedirectUri,
      codeChallenge: effectiveCodeChallenge,
      state: effectiveState,
      userId: authUser.id,
    }
    session.put(CONSENT_KEY, consent)

    return inertia.render('auth/oauth_consent', {
      clientName,
      redirectHost: new URL(effectiveRedirectUri).host,
      returnsToApp: this.isOwnOrigin(request, effectiveRedirectUri),
      role: authUser.role,
      account: { displayName: authUser.displayName, email: authUser.email },
    })
  }

  async store({ request, response, auth, session, inertia, i18n }: HttpContext) {
    const consent = session.pull(CONSENT_KEY) as ConsentRequest | undefined
    const authUser = auth.use('web').user

    if (!consent || !authUser || consent.userId !== authUser.id) {
      return response.status(400).send('No pending authorization request')
    }
    if (session.has('__impersonation')) {
      response.status(403)
      return inertia.render('auth/oauth_consent', { blocked: 'impersonating' })
    }

    // Only when the client sends the user back into this app does a flash make sense —
    // an external client (claude.ai) shows the outcome itself, and a flash would otherwise
    // pop up at some unrelated later visit.
    const returnsToApp = this.isOwnOrigin(request, consent.redirectUri)
    const redirectUrl = new URL(consent.redirectUri)
    if (consent.state) redirectUrl.searchParams.set('state', consent.state)

    if (request.input('decision') !== 'approve') {
      redirectUrl.searchParams.set('error', 'access_denied')
      logger.info({ type: 'mcp_oauth_denied', clientId: consent.clientId, userId: authUser.id })
      if (returnsToApp) {
        session.flash('alert', {
          type: 'info',
          message: i18n.t('messages.mcp_connect_declined', { client: consent.clientName }),
        })
      }
      return this.redirectOut(request, response, inertia, redirectUrl)
    }

    const code = randomBytes(32).toString('hex')
    await McpOauthCode.create({
      code,
      clientId: consent.clientId,
      userId: authUser.id,
      redirectUri: consent.redirectUri,
      codeChallenge: consent.codeChallenge,
      used: false,
      expiresAt: DateTime.now().plus({ minutes: 5 }),
    })

    logger.info({ type: 'mcp_oauth_code_issued', clientId: consent.clientId, userId: authUser.id })

    redirectUrl.searchParams.set('code', code)
    if (returnsToApp) {
      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.mcp_connect_approved', { client: consent.clientName }),
      })
    }
    return this.redirectOut(request, response, inertia, redirectUrl)
  }

  /** Whether the client sends the user back into this app (APP_URL, else the request host). */
  private isOwnOrigin(request: HttpContext['request'], redirectUri: string): boolean {
    try {
      const appUrl = env.get('APP_URL')
      const ownHost = appUrl ? new URL(appUrl).host : request.host()
      return new URL(redirectUri).host === ownHost
    } catch {
      return false
    }
  }

  /** The consent form posts through Inertia, which needs a hard location for another origin. */
  private redirectOut(
    request: HttpContext['request'],
    response: HttpContext['response'],
    inertia: HttpContext['inertia'],
    url: URL
  ) {
    if (request.header('x-inertia')) {
      return inertia.location(url.toString())
    }
    return response.redirect(url.toString())
  }
}
