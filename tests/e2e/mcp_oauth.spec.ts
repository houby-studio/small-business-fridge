import { test, expect } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { ensureLoginPage, fillLoginForm } from './helpers/auth'

/**
 * E2E: MCP OAuth 2.1 flow through the real browser login.
 *
 * Covers: dynamic client registration → /oauth/authorize redirects an anonymous
 * user to /login?returnTo=... → after logging in the authorization code is issued
 * and delivered to the registered redirect_uri → the code exchanges for an access
 * token that authenticates at /mcp.
 */
test.describe('MCP OAuth flow', () => {
  test('anonymous authorize → login → code → token → /mcp', async ({ page, baseURL }) => {
    await page.context().clearCookies()

    // Loopback redirect target — points back at the app so the browser stays local.
    const redirectUri = `${baseURL}/profile`

    // 1. Dynamic client registration (RFC 7591)
    const registration = await page.request.post('/oauth/register', {
      data: { client_name: 'E2E MCP Client', redirect_uris: [redirectUri] },
    })
    expect(registration.status()).toBe(201)
    const { client_id: clientId } = await registration.json()

    // 2. PKCE pair
    const codeVerifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

    // 3. Authorize as an anonymous user → redirected to login with returnTo
    const authorizeUrl =
      `/oauth/authorize?client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code&code_challenge=${codeChallenge}&code_challenge_method=S256&state=e2e`
    await page.goto(authorizeUrl)
    await expect(page).toHaveURL(
      /\/login\?returnTo=%2Foauth%2Fauthorize|\/login\?returnTo=\/oauth\/authorize/
    )

    // 4. Log in through the real form — the flow resumes and lands on redirect_uri?code=...
    await ensureLoginPage(page)
    await fillLoginForm(page, 'customer@localhost', 'customer123')
    await page.waitForURL(/\/profile\?.*code=/, { timeout: 10_000 })

    const url = new URL(page.url())
    const code = url.searchParams.get('code')!
    expect(code).toBeTruthy()
    expect(url.searchParams.get('state')).toBe('e2e')

    // 5. Exchange the code for an access token (PKCE)
    const tokenResponse = await page.request.post('/oauth/token', {
      data: {
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        client_id: clientId,
      },
    })
    expect(tokenResponse.status()).toBe(200)
    const { access_token: accessToken } = await tokenResponse.json()
    expect(accessToken).toBeTruthy()

    // 6. The token authenticates at /mcp (initialize handshake)
    const mcpResponse = await page.request.post('/mcp', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'e2e-client', version: '1.0.0' },
        },
      },
    })
    expect(mcpResponse.status()).toBe(200)
    const bodyText = await mcpResponse.text()
    expect(bodyText).toContain('small-business-fridge-mcp')
  })
})
