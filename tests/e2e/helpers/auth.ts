import { expect, type Page } from '@playwright/test'

export type TestUser = 'admin' | 'supplier' | 'customer' | 'customer2' | 'kiosk'

const PASSWORDS: Record<TestUser, string> = {
  admin: 'admin123',
  supplier: 'supplier123',
  customer: 'customer123',
  customer2: 'customer123',
  kiosk: 'kiosk123',
}

const cachedSessionCookies = new Map<string, any[]>()

function resolveSessionKey(user: TestUser) {
  return user
}

async function completeBootstrapIfNeeded(page: Page) {
  if (!/\/setup\/bootstrap(?:\?|$)/.test(page.url())) return

  const bootstrapUsername = 'bootstrap-e2e-admin'
  const bootstrapPassword = 'admin123'

  await expect(page.locator('#bootstrapDisplayName')).toBeVisible()
  await page.locator('#bootstrapDisplayName').fill('Bootstrap E2E Admin')
  await page.locator('#bootstrapEmail').fill('bootstrap-e2e-admin@localhost')
  await page.locator('#bootstrapUsername').fill(bootstrapUsername)
  await page.locator('#bootstrapPassword').fill(bootstrapPassword)
  await page.locator('#bootstrapPasswordConfirmation').fill(bootstrapPassword)
  await page.locator('button[type="submit"]').click()
  await page.waitForLoadState('domcontentloaded')

  // Bootstrap logs in the newly created admin. Clear session to continue as guest in auth tests.
  await page.context().clearCookies()
}

export async function ensureLoginPage(page: Page) {
  const url = page.url()
  if (!/\/(?:login|setup\/bootstrap)(?:\?|$)/.test(url)) {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')
  }

  if (/\/setup\/bootstrap(?:\?|$)/.test(page.url())) {
    await completeBootstrapIfNeeded(page)
  }

  if (!/\/login(?:\?|$)/.test(page.url())) {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')
  }

  if (/\/auth\/oidc\/redirect(?:\?|$)/.test(page.url())) {
    throw new Error(
      'Unexpected OIDC redirect during e2e local-login flow. Ensure LOCAL_LOGIN_DISABLED=false for Playwright web server.'
    )
  }

  if (/\/login(?:\?|$)/.test(page.url())) {
    await expect(page.locator('#username')).toBeVisible({ timeout: 10_000 })
  }
}

export async function fillLoginForm(page: Page, username: string, password: string) {
  const usernameInput = page.locator('#username')
  const passwordInput = page.locator('#password')

  await expect(usernameInput).toBeVisible()
  await expect(passwordInput).toBeVisible()

  await usernameInput.fill(username)
  await expect(usernameInput).toHaveValue(username)

  await passwordInput.fill(password)
  await expect(passwordInput).toHaveValue(password)

  await passwordInput.press('Enter')
}

async function hasLoginForm(page: Page) {
  const usernameInput = page.locator('#username')
  const passwordInput = page.locator('#password')
  const isUsernameVisible = await usernameInput.isVisible().catch(() => false)
  const isPasswordVisible = await passwordInput.isVisible().catch(() => false)
  return isUsernameVisible && isPasswordVisible
}

async function tryLogin(page: Page, username: string, password: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await ensureLoginPage(page)
    if (!/\/login(?:\?|$)/.test(page.url())) {
      return true
    }
    if (!(await hasLoginForm(page))) {
      if (!/\/login(?:\?|$)/.test(page.url())) {
        return true
      }
      continue
    }

    await fillLoginForm(page, username, password)
    await page.waitForLoadState('domcontentloaded')

    if (!/\/login(?:\?|$)/.test(page.url())) {
      return true
    }
  }

  return false
}

async function tryWithCachedSession(page: Page, sessionKey: string) {
  const cookies = cachedSessionCookies.get(sessionKey)
  if (!cookies?.length) return false

  await page.context().clearCookies()
  await page.context().addCookies(cookies)
  await page.goto('/shop')
  await page.waitForLoadState('domcontentloaded')
  return !/\/login(?:\?|$)/.test(page.url())
}

async function rememberSession(page: Page, sessionKey: string) {
  const cookies = await page.context().cookies()
  cachedSessionCookies.set(sessionKey, cookies)
}

/**
 * Logs in as the given test user.
 *
 * Uses domcontentloaded for session checks to keep tests fast — we only need the
 * server's redirect decision (is the session valid?), not full JS execution.
 * Test assertions that need Vue-rendered content use their own retry timeouts.
 *
 * After loginAs the page is on /shop (or the post-login redirect target).
 */
export async function loginAs(page: Page, user: TestUser) {
  const sessionKey = resolveSessionKey(user)

  // Fast path: check if this browser context is already authenticated.
  // domcontentloaded is enough — only the server-side redirect matters here.
  await page.goto('/shop')
  await page.waitForLoadState('domcontentloaded')
  if (!/\/login(?:\?|$)/.test(page.url())) {
    await rememberSession(page, sessionKey)
    return
  }

  // Try restoring a session saved in this test run (avoids repeating the login form)
  if (await tryWithCachedSession(page, sessionKey)) {
    await expect(page).not.toHaveURL(/\/login/)
    return
  }

  // Full login flow
  const succeeded = await tryLogin(page, user, PASSWORDS[user])
  if (succeeded) {
    await rememberSession(page, sessionKey)
    await expect(page).not.toHaveURL(/\/login/)
    return
  }

  await expect(page).not.toHaveURL(/\/login/)
}
