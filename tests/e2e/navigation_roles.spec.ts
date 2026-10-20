import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'
import { loginAsFreshSupplier } from './helpers/isolated_supplier'
import { createProduct, discardDraft } from './helpers/products'

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

    // At 1366 px the admin bar is crowded: the groups show as icons, named by aria-label.
    const nav = page.locator('.sbf-nav')
    await expect(nav.getByRole('menuitem', { name: 'Dodavatel', exact: true })).toBeVisible()
    await expect(nav.getByRole('menuitem', { name: 'Admin', exact: true })).toBeVisible()
    await expect(nav.getByText('Dodavatel', { exact: true })).toBeHidden()

    // From 1440 px the same groups carry their text labels again.
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(nav.getByText('Dodavatel', { exact: true })).toBeVisible()
    await expect(nav.getByText('Admin', { exact: true })).toBeVisible()
  })

  test('a stocking draft lives under "Sklad": no own menu entry, badge and highlight there', async ({
    page,
  }) => {
    await loginAsFreshSupplier(page, 'navigation-roles')
    // The product form lands on the supplier's open draft (příjemka) with a line in it.
    await createProduct(page, `E2E Menu ${Date.now()}`)
    await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+/)

    const nav = page.locator('.sbf-nav')
    await nav.getByText('Dodavatel', { exact: true }).click()
    const stock = nav.getByRole('menuitem', { name: /^Sklad/ })
    await expect(stock).toBeVisible()
    await expect(stock.getByTestId('nav-stock-badge')).toHaveText('1')
    await expect(nav.getByText('Naskladnění', { exact: true })).toHaveCount(0)
    await expect(page.locator('.sbf-nav-active', { hasText: 'Sklad' }).first()).toBeVisible()
    await page.keyboard.press('Escape')

    // Leave no half-filled line on the shared supplier's draft for the next spec.
    await discardDraft(page)
  })

  test('logout control is always available in the app bar', async ({ page }) => {
    await loginAs(page, 'supplier')
    await expect(page.locator('button[aria-label="Odhlásit se"]')).toBeVisible()
  })

  test('english locale renders app bar labels in english', async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
    // Wide enough for the admin bar to show every label as text.
    await page.setViewportSize({ width: 1440, height: 900 })
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
