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

    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Dodavatel' }).click()
    await page.getByRole('button', { name: 'Použít filtry' }).click()

    await expect(page).toHaveURL(/\/admin\/users\?.*role=supplier/)
    await expect(page.locator('table')).toContainText('Dodavatel')
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
})
