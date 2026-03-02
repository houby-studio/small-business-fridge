import { expect, type Page } from '@playwright/test'

export type TestUser = 'admin' | 'supplier' | 'customer' | 'customer2' | 'kiosk'

const PASSWORDS: Record<TestUser, string> = {
  admin: 'admin123',
  supplier: 'supplier123',
  customer: 'customer123',
  customer2: 'customer123',
  kiosk: 'kiosk123',
}

const EMAILS: Record<TestUser, string> = {
  admin: 'admin@localhost',
  supplier: 'supplier@localhost',
  customer: 'customer@localhost',
  customer2: 'customer2@localhost',
  kiosk: 'kiosk@localhost',
}

async function completeBootstrapIfNeeded(page: Page) {
  if (!/\/setup\/bootstrap(?:\?|$)/.test(page.url())) return

  const bootstrapPassword = 'admin123'

  await expect(page.locator('#bootstrapDisplayName')).toBeVisible()
  await page.locator('#bootstrapDisplayName').fill('Bootstrap E2E Admin')
  await page.locator('#bootstrapEmail').fill('bootstrap-e2e-admin@localhost')
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

  if (/\/auth\/[^/]+\/redirect(?:\?|$)/.test(page.url())) {
    throw new Error(
      'Unexpected provider redirect during e2e local-login flow. Ensure AUTH_PROVIDERS includes local for Playwright web server.'
    )
  }

  if (/\/login(?:\?|$)/.test(page.url())) {
    const emailInput = page.locator('#email')
    try {
      await expect(emailInput).toBeVisible({ timeout: 10_000 })
    } catch {
      // In rare startup races the login shell renders before the JS app hydrates.
      // Reload once to force a clean render before failing.
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(emailInput).toBeVisible({ timeout: 10_000 })
    }
  }
}

export async function fillLoginForm(page: Page, email: string, password: string) {
  const emailInput = page.locator('#email')
  const passwordInput = page.locator('#password')
  const submitButton = page.locator('button[type="submit"]')

  await expect(emailInput).toBeVisible()
  await expect(passwordInput).toBeVisible()
  await expect(submitButton).toBeVisible()

  await emailInput.fill(email)
  await passwordInput.fill(password)
  await expect(submitButton).toBeEnabled({ timeout: 10_000 })
  await submitButton.click()
}

async function waitForLoginAttemptToSettle(page: Page) {
  await Promise.race([
    page.waitForURL((url) => !/\/login(?:\?|$)/.test(url.pathname + url.search), { timeout: 5000 }),
    page.locator('button[type="submit"]').first().waitFor({ state: 'visible', timeout: 5000 }),
  ]).catch(() => {})

  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
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
  // Keep login deterministic across tests/users in the same browser context.
  await page.context().clearCookies()
  await ensureLoginPage(page)
  await fillLoginForm(page, EMAILS[user], PASSWORDS[user])
  await waitForLoginAttemptToSettle(page)

  await expect(page).not.toHaveURL(/\/login/)
}
