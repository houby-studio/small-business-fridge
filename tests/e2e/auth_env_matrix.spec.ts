import { test, expect } from '@playwright/test'

const E2E_INVITE_TOKEN = 'e2e-customer-invite-token'

function responseLocation(response: { headers(): Record<string, string> }): string {
  return response.headers()['location'] ?? ''
}

test.describe('Auth ENV matrix smoke', () => {
  test('single provider (microsoft) redirects and blocks local-only pages', async ({
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'auth-single-microsoft')

    const login = await request.get('/login', { maxRedirects: 0 })
    expect(login.status()).toBe(302)
    expect(responseLocation(login)).toBe('/auth/microsoft/redirect')

    const register = await request.get('/register', { maxRedirects: 0 })
    expect(register.status()).toBe(302)
    expect(responseLocation(register)).toBe('/login')

    const forgot = await request.get('/forgot-password', { maxRedirects: 0 })
    expect(forgot.status()).toBe(302)
    expect(responseLocation(forgot)).toBe('/login')

    const invite = await request.get(`/register/invite/${E2E_INVITE_TOKEN}`, { maxRedirects: 0 })
    expect(invite.status()).toBe(302)
    expect(responseLocation(invite)).toBe(
      `/auth/microsoft/redirect?intent=invite&token=${encodeURIComponent(E2E_INVITE_TOKEN)}`
    )
  })

  test('multi provider mode renders provider choices and invite provider actions', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'auth-multi-providers')

    const loginResp = await request.get('/login', { maxRedirects: 0 })
    expect(loginResp.status()).toBe(200)

    await page.goto('/login')
    await expect(page.locator('a[href="/auth/microsoft/redirect"]')).toBeVisible()
    await expect(page.locator('a[href="/auth/discord/redirect"]')).toBeVisible()
    await expect(page.locator('#email')).toHaveCount(0)

    const register = await request.get('/register', { maxRedirects: 0 })
    expect(register.status()).toBe(302)
    expect(responseLocation(register)).toBe('/login')

    await page.goto(`/register/invite/${E2E_INVITE_TOKEN}`)
    await expect(
      page.locator(
        `a[href="/auth/microsoft/redirect?intent=invite&token=${encodeURIComponent(E2E_INVITE_TOKEN)}"]`
      )
    ).toBeVisible()
    await expect(
      page.locator(
        `a[href="/auth/discord/redirect?intent=invite&token=${encodeURIComponent(E2E_INVITE_TOKEN)}"]`
      )
    ).toBeVisible()
    await expect(page.locator('#invitePassword')).toHaveCount(0)
  })

  test('hybrid mode keeps local forms and includes provider actions', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'auth-hybrid-local-microsoft')

    const loginResp = await request.get('/login', { maxRedirects: 0 })
    expect(loginResp.status()).toBe(200)

    await page.goto('/login')
    await expect(page.locator('#email')).toBeVisible()
    await expect(page.locator('#password')).toBeVisible()
    await expect(page.locator('a[href="/auth/microsoft/redirect"]')).toBeVisible()

    const registerResp = await request.get('/register', { maxRedirects: 0 })
    expect(registerResp.status()).toBe(200)
    await page.goto('/register')
    await expect(page.locator('#registerDisplayName')).toBeVisible()

    const forgotResp = await request.get('/forgot-password', { maxRedirects: 0 })
    expect(forgotResp.status()).toBe(200)
    await page.goto('/forgot-password')
    await expect(page.locator('#forgotEmail')).toBeVisible()

    await page.goto(`/register/invite/${E2E_INVITE_TOKEN}`)
    await expect(page.locator('#inviteDisplayName')).toBeVisible()
    await expect(page.locator('#invitePassword')).toBeVisible()
    await expect(
      page.locator(
        `a[href="/auth/microsoft/redirect?intent=invite&token=${encodeURIComponent(E2E_INVITE_TOKEN)}"]`
      )
    ).toBeVisible()
  })
})
