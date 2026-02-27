import { test, expect } from '@playwright/test'
import { ensureLoginPage, fillLoginForm, loginAs } from './helpers/auth'

/**
 * E2E: Authentication flows (login / logout)
 *
 * Requires dev users seeded in the test DB (see global-setup.ts).
 *
 * Selectors used:
 *   #username     — InputText component (id maps directly to input)
 *   #password     — Password component (inputId maps to inner input)
 *   button[type="submit"] — submit button
 *   button:has(.pi-sign-out) — logout icon button in the nav bar
 */

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoginPage(page)
  })

  test('shows login form with required fields', async ({ page }) => {
    await expect(page.locator('#username')).toBeVisible()
    await expect(page.locator('#password')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('unauthenticated visit to / shows home page with sign-in link', async ({ page }) => {
    await page.goto('/')
    // Home page renders a sign-in link (not a redirect) for unauthenticated users
    await expect(page.locator('a[href="/login"]')).toBeVisible()
  })

  test('unauthenticated visit to /shop redirects to /login', async ({ page }) => {
    await page.goto('/shop')
    await expect(page).toHaveURL(/\/login/)
  })

  test('bootstrap route redirects to login when admin already exists', async ({ page }) => {
    await page.goto('/setup/bootstrap')
    await expect(page).toHaveURL(/\/login/)
  })

  test('invalid credentials stays on login and shows error', async ({ page }) => {
    await fillLoginForm(page, 'nobody', 'wrongpassword')
    await expect(page).toHaveURL(/\/login/)
    // Error displayed as a PrimeVue Toast (flash message via session.flash -> useFlash composable)
    await expect(page.locator('[role="alert"]')).toBeVisible()
  })

  test('customer can log in and is redirected to shop', async ({ page }) => {
    await fillLoginForm(page, 'customer', 'customer123')
    await expect(page).toHaveURL(/\/shop/)
  })

  test('admin can log in', async ({ page }) => {
    await fillLoginForm(page, 'admin', 'admin123')
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('supplier can log in', async ({ page }) => {
    await fillLoginForm(page, 'supplier', 'supplier123')
    await expect(page).not.toHaveURL(/\/login/)
  })
})

test.describe('Logout', () => {
  test('logged-in customer can log out via header button', async ({ page }) => {
    await loginAs(page, 'customer')

    // Logout via the icon button in the navigation bar (pi-sign-out icon)
    await page.locator('button:has(.pi-sign-out)').click()

    await expect(page).toHaveURL(/\/$|\/login/)
  })
})
