import { test, expect } from '@playwright/test'
import pg from 'pg'
import { ensureLoginPage, fillLoginForm, loginAs } from './helpers/auth'

const { Client } = pg

/**
 * E2E: Authentication flows (login / logout)
 *
 * Requires dev users seeded in the test DB (see global-setup.ts).
 *
 * Selectors used:
 *   #email        — InputText component (id maps directly to input)
 *   #password     — Password component (inputId maps to inner input)
 *   button[type="submit"] — submit button
 *   button:has(.pi-sign-out) — logout icon button in the nav bar
 */

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoginPage(page)
  })

  test('shows login form with required fields', async ({ page }) => {
    await expect(page.locator('#email')).toBeVisible()
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

  test('bootstrap page renders local-first setup when no admin exists', async ({ page }) => {
    const client = new Client({
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5432),
      user: process.env.DB_USER ?? 'sbf',
      password: process.env.DB_PASSWORD ?? 'sbf',
      database: process.env.DB_DATABASE ?? 'sbf_test',
    })

    await client.connect()
    const result = await client.query<{ id: number }>(
      `UPDATE users
       SET role = 'customer'
       WHERE role = 'admin'
       RETURNING id`
    )

    try {
      await page.goto('/setup/bootstrap')
      await expect(page).toHaveURL(/\/setup\/bootstrap/)
      await expect(page.locator('#bootstrapDisplayName')).toBeVisible()
      await expect(
        page.locator('a[href*="/auth/"][href*="/redirect?intent=bootstrap"]')
      ).toHaveCount(0)

      const submit = page.locator('button[type="submit"]')
      await expect(submit).toBeDisabled()
    } finally {
      if (result.rows.length > 0) {
        await client.query("UPDATE users SET role = 'admin' WHERE id = ANY($1::int[])", [
          result.rows.map((row) => row.id),
        ])
      }
      await client.end()
    }
  })

  test('invalid credentials stays on login and shows error', async ({ page }) => {
    await fillLoginForm(page, 'nobody@example.com', 'wrongpassword')
    await expect(page).toHaveURL(/\/login/)
    // Error displayed as a PrimeVue Toast (flash message via session.flash -> useFlash composable)
    await expect(page.locator('[role="alert"]')).toBeVisible()
  })

  test('customer can log in and is redirected to shop', async ({ page }) => {
    await fillLoginForm(page, 'customer@localhost', 'customer123')
    await expect(page).toHaveURL(/\/shop/)
  })

  test('admin can log in', async ({ page }) => {
    await fillLoginForm(page, 'admin@localhost', 'admin123')
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('supplier can log in', async ({ page }) => {
    await fillLoginForm(page, 'supplier@localhost', 'supplier123')
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
