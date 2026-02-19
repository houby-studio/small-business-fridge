import { test, expect } from '@playwright/test'

/**
 * E2E: Shop page browsing and navigation
 *
 * These tests verify the shop UI renders correctly and role-based access works.
 * Purchase flows are covered by Japa functional tests (faster, no browser needed).
 */

async function loginAs(page: import('@playwright/test').Page, username: string, password: string) {
  await page.goto('/login')
  await page.locator('#username').fill(username)
  await page.locator('#password').fill(password)
  await page.locator('button[type="submit"]').click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Shop page', () => {
  test('unauthenticated user is redirected away from /shop', async ({ page }) => {
    await page.goto('/shop')
    await expect(page).toHaveURL(/\/login/)
  })

  test('customer can view the shop page', async ({ page }) => {
    await loginAs(page, 'customer', 'customer123')
    await expect(page).toHaveURL(/\/shop/)
    await expect(page.locator('h1')).toBeVisible()
  })

  test('shop page has category filter buttons', async ({ page }) => {
    await loginAs(page, 'customer', 'customer123')
    // Category buttons should be visible (e.g. "Vše" = All)
    await expect(page.getByRole('button', { name: 'Vše' })).toBeVisible()
  })

  test('shop page shows product cards', async ({ page }) => {
    await loginAs(page, 'customer', 'customer123')
    // At least one "Koupit" (Buy) button should be visible
    await expect(page.getByRole('button', { name: 'Koupit' }).first()).toBeVisible()
  })

  test('shop page shows no browser console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => {
      // Ignore Vite HMR WebSocket errors that occur in test mode (server runs without HMR)
      if (err.message.includes('WebSocket')) return
      errors.push(err.message)
    })

    await loginAs(page, 'customer', 'customer123')
    await page.waitForLoadState('networkidle')

    expect(errors).toHaveLength(0)
  })
})

test.describe('Role-based navigation access', () => {
  test('supplier can access supplier invoice page', async ({ page }) => {
    await loginAs(page, 'supplier', 'supplier123')
    await page.goto('/supplier/invoice')
    await expect(page).toHaveURL(/\/supplier\/invoice/)
  })

  test('customer is redirected away from supplier section', async ({ page }) => {
    await loginAs(page, 'customer', 'customer123')
    await page.goto('/supplier/invoice')
    await expect(page).not.toHaveURL(/\/supplier\/invoice/)
  })

  test('admin can access admin dashboard', async ({ page }) => {
    await loginAs(page, 'admin', 'admin123')
    await page.goto('/admin/dashboard')
    await expect(page).toHaveURL(/\/admin\/dashboard/)
  })

  test('customer is redirected away from admin section', async ({ page }) => {
    await loginAs(page, 'customer', 'customer123')
    await page.goto('/admin/dashboard')
    await expect(page).not.toHaveURL(/\/admin\/dashboard/)
  })

  test('invoices page loads for customer', async ({ page }) => {
    await loginAs(page, 'customer', 'customer123')
    await page.goto('/invoices')
    await expect(page).toHaveURL(/\/invoices/)
    await expect(page.locator('h1')).toBeVisible()
  })

  test('orders page loads for customer', async ({ page }) => {
    await loginAs(page, 'customer', 'customer123')
    await page.goto('/orders')
    await expect(page).toHaveURL(/\/orders/)
    await expect(page.locator('h1')).toBeVisible()
  })
})
