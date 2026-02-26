import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'

test.describe('Admin pages and filters', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin')
  })

  test('admin can open all admin pages', async ({ page }) => {
    const targets = [
      '/admin/dashboard',
      '/admin/users',
      '/admin/categories',
      '/admin/allergens',
      '/admin/orders',
      '/admin/invoices',
      '/admin/audit',
    ]

    for (const url of targets) {
      await page.goto(url)
      await expect(page).toHaveURL(new RegExp(url.replace('/', '\\/')))
      await expect(page.locator('h1')).toBeVisible()
    }
  })

  test('admin users supports role filter', async ({ page }) => {
    await page.goto('/admin/users')

    await page.getByRole('combobox').nth(1).click()
    await page.getByRole('option', { name: 'Dodavatel' }).click()
    await page.getByRole('button', { name: 'Použít filtry' }).click()

    await expect(page).toHaveURL(/\/admin\/users\?.*role=supplier/)
    await expect(page.locator('table')).toContainText('Dodavatel')
  })

  test('admin users supports disabled filter', async ({ page }) => {
    await page.goto('/admin/users')

    await page.getByRole('combobox').nth(2).click()
    await page.getByRole('option', { name: 'Povolen' }).click()
    await page.getByRole('button', { name: 'Použít filtry' }).click()

    await expect(page).toHaveURL(/\/admin\/users\?.*disabled=enabled/)
  })

  test('admin orders supports supplier filter', async ({ page }) => {
    await page.goto('/admin/orders')

    await page.getByRole('combobox').nth(3).click()
    await page.getByRole('option', { name: 'Supplier User' }).click()
    await page.getByRole('button', { name: 'Použít filtry' }).click()

    await expect(page).toHaveURL(/\/admin\/orders\?.*supplierId=/)
    await expect(page.locator('table')).toContainText('Supplier User')
  })

  test('admin orders supports invoiced filter', async ({ page }) => {
    await page.goto('/admin/orders')

    await page.getByRole('combobox').nth(1).click()
    await page.getByRole('option', { name: 'Fakturováno', exact: true }).click()
    await page.getByRole('button', { name: 'Použít filtry' }).click()

    await expect(page).toHaveURL(/\/admin\/orders\?.*invoiced=yes/)
  })

  test('admin invoices can filter paid status', async ({ page }) => {
    await page.goto('/admin/invoices')

    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Zaplaceno', exact: true }).click()
    await page.getByRole('button', { name: 'Použít filtry' }).click()

    await expect(page).toHaveURL(/\/admin\/invoices\?.*status=paid/)
    await expect(page.locator('table')).toContainText('Zaplaceno')
  })

  test('admin invoices can filter awaiting status', async ({ page }) => {
    await page.goto('/admin/invoices')

    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Čeká na schválení' }).click()
    await page.getByRole('button', { name: 'Použít filtry' }).click()

    await expect(page).toHaveURL(/\/admin\/invoices\?.*status=awaiting/)
    await expect(page.locator('table')).toContainText('Čeká na schválení')
  })

  test('admin invoices can filter unpaid status', async ({ page }) => {
    await page.goto('/admin/invoices')

    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Nezaplaceno' }).click()
    await page.getByRole('button', { name: 'Použít filtry' }).click()

    await expect(page).toHaveURL(/\/admin\/invoices\?.*status=unpaid/)
    await expect(page.locator('table')).toContainText('Nezaplaceno')
  })

  test('admin invoices supports customer and supplier filters', async ({ page }) => {
    await page.goto('/admin/invoices')

    await page.getByRole('combobox').nth(1).click()
    await page.getByRole('option', { name: 'Customer User' }).click()
    await page.getByRole('combobox').nth(2).click()
    await page.getByRole('option', { name: 'Supplier User' }).click()
    await page.getByRole('button', { name: 'Použít filtry' }).click()

    await expect(page).toHaveURL(/\/admin\/invoices\?.*buyerId=.*supplierId=/)
    await expect(page.locator('table')).toContainText('Customer User')
    await expect(page.locator('table')).toContainText('Supplier User')
  })

  test('admin can open and submit new category/allergen dialogs from keyboard without runtime errors', async ({
    page,
  }) => {
    const runtimeErrors: string[] = []
    const criticalConsoleMessages: string[] = []
    const forbiddenPatterns = [
      'resolveComponent can only be used in render() or setup()',
      'resolveDirective can only be used in render() or setup()',
      'Unhandled error during execution of render function',
      "Cannot read properties of null (reading 'ce')",
    ]

    page.on('pageerror', (err) => {
      if (err.message.includes('WebSocket')) return
      runtimeErrors.push(err.message)
    })
    page.on('console', (msg) => {
      if (msg.type() !== 'warning' && msg.type() !== 'error') return
      const text = msg.text()
      if (forbiddenPatterns.some((pattern) => text.includes(pattern))) {
        criticalConsoleMessages.push(text)
      }
    })

    await page.goto('/admin/categories')
    await expect(page.getByRole('columnheader', { name: '#' })).toBeVisible()
    await page.getByRole('button', { name: 'Nová kategorie' }).click()
    const categoryDialog = page.getByRole('dialog', { name: 'Nová kategorie' })
    await expect(categoryDialog).toBeVisible()
    const categoryNameInput = categoryDialog.getByRole('textbox').first()
    await expect(categoryNameInput).toBeFocused()
    await page.waitForTimeout(700)
    await expect(categoryNameInput).toBeFocused()
    const newCategoryName = `E2E Category ${Date.now()}`
    await categoryNameInput.fill(newCategoryName)
    await categoryNameInput.press('Enter')
    await expect(categoryDialog).toBeHidden()
    await expect(page.locator('table')).toContainText(newCategoryName)

    await page.goto('/admin/allergens')
    await expect(page.getByRole('columnheader', { name: '#' })).toBeVisible()
    await page.getByRole('button', { name: 'Nový alergen' }).click()
    const allergenDialog = page.getByRole('dialog', { name: 'Nový alergen' })
    await expect(allergenDialog).toBeVisible()
    const allergenNameInput = allergenDialog.getByRole('textbox').first()
    await expect(allergenNameInput).toBeFocused()
    await page.waitForTimeout(700)
    await expect(allergenNameInput).toBeFocused()
    const newAllergenName = `E2E Allergen ${Date.now()}`
    await allergenNameInput.fill(newAllergenName)
    await allergenNameInput.press('Enter')
    await expect(allergenDialog).toBeHidden()
    await expect(page.locator('table')).toContainText(newAllergenName)

    expect(runtimeErrors).toHaveLength(0)
    expect(criticalConsoleMessages).toHaveLength(0)
  })

  test('admin edit mode autofocuses category and allergen name inputs', async ({ page }) => {
    await page.goto('/admin/categories')
    await page.locator('button:has(.pi-pencil)').first().click()
    await expect(page.locator('input[id^=\"admin-category-edit-name-\"]')).toBeFocused()

    await page.goto('/admin/allergens')
    await page.locator('button:has(.pi-pencil)').first().click()
    await expect(page.locator('input[id^=\"admin-allergen-edit-name-\"]')).toBeFocused()
  })
})
