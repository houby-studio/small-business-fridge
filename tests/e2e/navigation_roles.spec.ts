import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'

test.describe('Role-aware app bar navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
  })

  test('customer sees only customer navigation (no supplier/admin groups)', async ({ page }) => {
    await loginAs(page, 'customer2')

    const nav = page.locator('.sbf-nav')
    await expect(nav.getByText('Obchod', { exact: true })).toBeVisible()
    await expect(nav.getByText('Objednávky', { exact: true })).toBeVisible()
    await expect(nav.getByText('Faktury', { exact: true })).toBeVisible()

    await expect(nav.getByText('Dodavatel', { exact: true })).toHaveCount(0)
    await expect(nav.getByText('Admin', { exact: true })).toHaveCount(0)
  })

  test('supplier sees supplier group but not admin group', async ({ page }) => {
    await loginAs(page, 'supplier')

    await expect(page.locator('.sbf-nav').getByText('Dodavatel', { exact: true })).toBeVisible()
    await expect(page.locator('.sbf-nav').getByText('Admin', { exact: true })).toHaveCount(0)
  })

  test('admin sees both supplier and admin groups', async ({ page }) => {
    await loginAs(page, 'admin')

    await expect(page.locator('.sbf-nav').getByText('Dodavatel', { exact: true })).toBeVisible()
    await expect(page.locator('.sbf-nav').getByText('Admin', { exact: true })).toBeVisible()
  })

  test('logout control is always available in the app bar', async ({ page }) => {
    await loginAs(page, 'supplier')
    await expect(page.locator('button[aria-label="Odhlásit se"]')).toBeVisible()
  })
})
