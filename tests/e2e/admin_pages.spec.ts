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
      '/admin/music',
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

    await page.locator('#admin-users-filter-role').click()
    await page.getByRole('option', { name: 'Dodavatel' }).click()
    await page.getByRole('button', { name: 'Použít filtry' }).click()

    await expect(page).toHaveURL(/\/admin\/users\?.*role=supplier/)
    await expect(page.locator('.p-datatable table')).toContainText('Dodavatel')
  })

  test('admin users supports disabled filter', async ({ page }) => {
    await page.goto('/admin/users')

    await page.locator('#admin-users-filter-disabled').click()
    await page.getByRole('option', { name: 'Povolen' }).click()
    await page.getByRole('button', { name: 'Použít filtry' }).click()

    await expect(page).toHaveURL(/\/admin\/users\?.*disabled=enabled/)
  })

  test('admin users filter search autofocuses and Enter selects first match', async ({ page }) => {
    await page.goto('/admin/users')

    await page.locator('#admin-users-filter-user').click()
    const searchInput = page.locator('.p-select-overlay:visible .p-select-filter').last()
    await expect(searchInput).toBeFocused()
    await searchInput.fill('Supplier User')
    await searchInput.press('Enter')
    await page.getByRole('button', { name: 'Použít filtry' }).click()

    await expect(page).toHaveURL(/\/admin\/users\?.*userId=/)
    await expect(page.locator('.p-datatable table')).toContainText('Supplier User')
  })

  test('admin can create and revoke invitation from users page', async ({ page }) => {
    await page.goto('/admin/users')
    const submitButton = page.getByRole('button', { name: 'Odeslat pozvánku' })
    await expect(submitButton).toBeDisabled()

    await page.getByPlaceholder('uzivatel@example.com').fill('invalid-email')
    await expect(submitButton).toBeDisabled()

    const inviteEmail = `invite-${Date.now()}@example.com`
    await page.getByPlaceholder('uzivatel@example.com').fill(inviteEmail)
    await expect(submitButton).toBeEnabled()
    await submitButton.click()

    await expect(page.locator('tr', { hasText: inviteEmail })).toBeVisible()
    await page
      .locator('tr', { hasText: inviteEmail })
      .getByRole('button', { name: 'Zrušit' })
      .click()
    await expect(page.locator('tr', { hasText: inviteEmail })).toContainText('Zrušena')
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

  test('admin orders customer/supplier search autofocuses and Enter selects first match', async ({
    page,
  }) => {
    await page.goto('/admin/orders')

    await page.getByRole('combobox').nth(2).click()
    const buyerSearchInput = page.locator('.p-select-overlay:visible .p-select-filter').last()
    await expect(buyerSearchInput).toBeFocused()
    await buyerSearchInput.fill('Customer User')
    await buyerSearchInput.press('Enter')

    await page.getByRole('combobox').nth(3).click()
    const supplierSearchInput = page.locator('.p-select-overlay:visible .p-select-filter').last()
    await expect(supplierSearchInput).toBeFocused()
    await supplierSearchInput.fill('Supplier User')
    await supplierSearchInput.press('Enter')

    await page.getByRole('button', { name: 'Použít filtry' }).click()
    await expect(page).toHaveURL(/\/admin\/orders\?.*buyerId=.*supplierId=/)
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

  test('admin invoices customer/supplier search autofocuses and Enter selects first match', async ({
    page,
  }) => {
    await page.goto('/admin/invoices')

    await page.getByRole('combobox').nth(1).click()
    const buyerSearchInput = page.locator('.p-select-overlay:visible .p-select-filter').last()
    await expect(buyerSearchInput).toBeFocused()
    await buyerSearchInput.fill('Customer User')
    await buyerSearchInput.press('Enter')

    await page.getByRole('combobox').nth(2).click()
    const supplierSearchInput = page.locator('.p-select-overlay:visible .p-select-filter').last()
    await expect(supplierSearchInput).toBeFocused()
    await supplierSearchInput.fill('Supplier User')
    await supplierSearchInput.press('Enter')

    await page.getByRole('button', { name: 'Použít filtry' }).click()
    await expect(page).toHaveURL(/\/admin\/invoices\?.*buyerId=.*supplierId=/)
  })

  test('admin audit user search Enter selects first match', async ({ page }) => {
    await page.goto('/admin/audit')

    await page.getByRole('combobox').nth(2).click()
    const searchInput = page.locator('.p-select-overlay:visible .p-select-filter').last()
    await expect(searchInput).toBeVisible()
    await searchInput.click()
    await searchInput.fill('Supplier User')
    await searchInput.press('Enter')
    await page.getByRole('button', { name: 'Použít filtry' }).click()

    await expect(page).toHaveURL(/\/admin\/audit\?.*userId=/)
  })

  test('admin can open and submit new category/allergen/music dialogs from keyboard without runtime errors', async ({
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
    await page.waitForTimeout(200)
    await expect(categoryNameInput).toBeFocused()
    const newCategoryName = `E2E Category ${Date.now()}`
    await categoryNameInput.fill(newCategoryName)
    await categoryNameInput.press('Enter')
    await expect(categoryDialog).toBeHidden()
    await expect(page.locator('table')).toContainText(newCategoryName)
    const categoryRow = page.locator('tbody tr', { hasText: newCategoryName })
    await categoryRow.locator('button:has(.pi-trash):not([disabled])').click()
    const categoryDeleteButton = page.getByRole('button', {
      name: 'Smazat kategorii',
      exact: true,
    })
    await expect(categoryDeleteButton).toBeVisible()
    await categoryDeleteButton.click()
    await expect(categoryRow).toHaveCount(0)

    await page.goto('/admin/allergens')
    await expect(page.getByRole('columnheader', { name: '#' })).toBeVisible()
    await page.getByRole('button', { name: 'Nový alergen' }).click()
    const allergenDialog = page.getByRole('dialog', { name: 'Nový alergen' })
    await expect(allergenDialog).toBeVisible()
    const allergenNameInput = allergenDialog.getByRole('textbox').first()
    await expect(allergenNameInput).toBeFocused()
    await page.waitForTimeout(200)
    await expect(allergenNameInput).toBeFocused()
    const newAllergenName = `E2E Allergen ${Date.now()}`
    await allergenNameInput.fill(newAllergenName)
    await allergenNameInput.press('Enter')
    await expect(allergenDialog).toBeHidden()
    await expect(page.locator('table')).toContainText(newAllergenName)
    const allergenRow = page.locator('tbody tr', { hasText: newAllergenName })
    await allergenRow.locator('button:has(.pi-trash):not([disabled])').click()
    const allergenDeleteButton = page.getByRole('button', { name: 'Smazat alergen', exact: true })
    await expect(allergenDeleteButton).toBeVisible()
    await allergenDeleteButton.click()
    await expect(allergenRow).toHaveCount(0)

    await page.goto('/admin/music')
    await expect(page.getByRole('columnheader', { name: '#' })).toBeVisible()
    await page.getByRole('button', { name: 'Nová skladba' }).click()
    const musicDialog = page.getByRole('dialog', { name: 'Nová skladba' })
    await expect(musicDialog).toBeVisible()
    const musicNameInput = musicDialog.getByRole('textbox').first()
    await expect(musicNameInput).toBeFocused()
    await page.waitForTimeout(200)
    await expect(musicNameInput).toBeFocused()
    const newMusicName = `E2E Music ${Date.now()}`
    await musicNameInput.fill(newMusicName)
    await musicDialog.locator('input[type="file"]').setInputFiles({
      name: 'e2e-track.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from('ID3-e2e-admin-track'),
    })
    await musicNameInput.press('Enter')
    await expect(musicDialog).toBeHidden()
    await expect(page.locator('table')).toContainText(newMusicName)
    const musicRow = page.locator('tbody tr', { hasText: newMusicName })
    await musicRow.locator('button:has(.pi-trash):not([disabled])').click()
    const musicDeleteButton = page.getByRole('button', { name: 'Smazat skladbu', exact: true })
    await expect(musicDeleteButton).toBeVisible()
    await musicDeleteButton.click()
    await expect(musicRow).toHaveCount(0)

    expect(runtimeErrors).toHaveLength(0)
    expect(criticalConsoleMessages).toHaveLength(0)
  })

  test('admin edit mode autofocuses category, allergen, and music name inputs', async ({
    page,
  }) => {
    await page.goto('/admin/categories')
    if ((await page.locator('button:has(.pi-pencil)').count()) === 0) {
      await page.getByRole('button', { name: 'Nová kategorie' }).click()
      const createDialog = page.getByRole('dialog', { name: 'Nová kategorie' })
      await createDialog.getByRole('textbox').first().fill(`E2E Autofocus Cat ${Date.now()}`)
      await createDialog.getByRole('textbox').first().press('Enter')
      await expect(createDialog).toBeHidden()
    }
    await page.locator('button:has(.pi-pencil)').first().click()
    await expect(page.locator('input[id^=\"admin-category-edit-name-\"]')).toBeFocused()

    await page.goto('/admin/allergens')
    if ((await page.locator('button:has(.pi-pencil)').count()) === 0) {
      await page.getByRole('button', { name: 'Nový alergen' }).click()
      const createDialog = page.getByRole('dialog', { name: 'Nový alergen' })
      await createDialog.getByRole('textbox').first().fill(`E2E Autofocus Allergen ${Date.now()}`)
      await createDialog.getByRole('textbox').first().press('Enter')
      await expect(createDialog).toBeHidden()
    }
    await page.locator('button:has(.pi-pencil)').first().click()
    await expect(page.locator('input[id^=\"admin-allergen-edit-name-\"]')).toBeFocused()

    await page.goto('/admin/music')
    if ((await page.locator('button:has(.pi-pencil)').count()) === 0) {
      await page.getByRole('button', { name: 'Nová skladba' }).click()
      const createDialog = page.getByRole('dialog', { name: 'Nová skladba' })
      const nameInput = createDialog.getByRole('textbox').first()
      await nameInput.fill(`E2E Autofocus Music ${Date.now()}`)
      await createDialog.locator('input[type="file"]').setInputFiles({
        name: 'e2e-autofocus-track.mp3',
        mimeType: 'audio/mpeg',
        buffer: Buffer.from('ID3-e2e-autofocus-track'),
      })
      await nameInput.press('Enter')
      await expect(createDialog).toBeHidden()
    }
    await page.locator('button:has(.pi-pencil)').first().click()
    await expect(page.locator('input[id^=\"admin-music-edit-name-\"]')).toBeFocused()
  })
})
