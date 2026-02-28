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

  test('english locale renders app bar labels in english', async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
    await loginAs(page, 'admin')

    const nav = page.locator('.sbf-nav')
    await expect(nav.getByText('Shop', { exact: true })).toBeVisible()
    await expect(nav.getByText('Orders', { exact: true }).first()).toBeVisible()
    await expect(nav.getByText('Invoices', { exact: true }).first()).toBeVisible()
    await expect(nav.getByText('Activity', { exact: true })).toBeVisible()
    await expect(nav.getByText('Supplier', { exact: true })).toBeVisible()
    await expect(nav.getByText('Admin', { exact: true })).toBeVisible()
    await expect(page.locator('button[aria-label="Sign out"]')).toBeVisible()
  })
})
