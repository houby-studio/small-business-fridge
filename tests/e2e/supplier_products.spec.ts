import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'

test.describe('Supplier products flow', () => {
  test('new product form enforces client-side validation', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')

    const createButton = page.getByRole('button', { name: 'Vytvořit produkt' })
    await expect(createButton).toBeDisabled()

    await page.locator('#product-name').fill('x'.repeat(256))
    await expect(page.getByText('Název produktu může mít maximálně 255 znaků.')).toBeVisible()
    await expect(createButton).toBeDisabled()

    await page.locator('#product-name').fill(`E2E Validace ${Date.now()}`)
    await page.locator('#product-description').fill('E2E popis produktu')

    await page.locator('#product-barcode').fill('1'.repeat(101))
    await expect(page.getByText('Čárový kód může mít maximálně 100 znaků.')).toBeVisible()
    await expect(createButton).toBeDisabled()
    await page.locator('#product-barcode').fill('')

    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Nealko' }).click()

    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-validation.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0JkAAAAASUVORK5CYII=',
        'base64'
      ),
    })

    await expect(createButton).toBeEnabled()
  })

  test('edit product form enforces client-side validation', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products')

    await page.locator('tbody tr button:has(.pi-pencil)').first().click()
    await expect(page).toHaveURL(/\/supplier\/products\/\d+\/edit/)

    const saveButton = page.getByRole('button', { name: 'Uložit změny' })
    await expect(saveButton).toBeEnabled()

    await page.locator('#edit-product-name').fill('')
    await expect(page.getByText('Název produktu je povinný.')).toBeVisible()
    await expect(saveButton).toBeDisabled()

    await page.locator('#edit-product-name').fill(`E2E Upraveno ${Date.now()}`)
    await expect(saveButton).toBeEnabled()
  })

  test('supplier products category tags keep white text color', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products')

    const categoryTag = page.locator('tbody tr .p-tag').first()
    await expect(categoryTag).toBeVisible()
    const color = await categoryTag.evaluate((el) => getComputedStyle(el).color)
    expect(color).toBe('rgb(255, 255, 255)')
  })

  test('create and edit pages expose keyboard-friendly name inputs', async ({ page }) => {
    const productName = `E2E Fokus ${Date.now()}`

    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')
    await expect(page.locator('#product-name')).toBeVisible()

    await page.locator('#product-name').fill(productName)
    await page.locator('#product-description').fill('E2E focus flow')

    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Nealko' }).click()

    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-focus.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0JkAAAAASUVORK5CYII=',
        'base64'
      ),
    })

    await page.getByRole('button', { name: 'Vytvořit produkt' }).click()
    await expect(page).toHaveURL(/\/supplier\/stock\?preselect=\d+/)

    const match = page.url().match(/preselect=(\d+)/)
    expect(match).not.toBeNull()

    await page.goto(`/supplier/products/${match![1]}/edit`)
    await expect(page.locator('#edit-product-name')).toBeVisible()
  })

  test('creating product redirects to stock with preselected product and focused amount', async ({
    page,
  }) => {
    const productName = `E2E Produkt ${Date.now()}`

    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')

    await page.getByPlaceholder('např. Coca-Cola 0.5l').fill(productName)
    await page.getByPlaceholder('Krátký popis produktu').fill('E2E testovací produkt')

    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Nealko' }).click()

    await page.getByPlaceholder('Volitelné — EAN kód').fill(String(Date.now()))

    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-product.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0JkAAAAASUVORK5CYII=',
        'base64'
      ),
    })

    await page.getByRole('button', { name: 'Vytvořit produkt' }).click()

    await expect(page).toHaveURL(/\/supplier\/stock\?preselect=\d+/)

    // The newly created product should be selected in the quick-delivery product field.
    await expect(page.getByRole('combobox').first()).toContainText(productName)

    // Amount should be auto-focused to speed up immediate stock delivery entry.
    await expect(page.getByPlaceholder('ks')).toBeFocused()
  })

  test('quick delivery supports enter-first keyboard flow', async ({ page }) => {
    const productName = `E2E Keyboard ${Date.now()}`

    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')

    await page.locator('#product-name').click()
    await page.keyboard.press('Enter')
    await expect(page.locator('#product-description')).toBeFocused()

    await page.locator('#product-description').fill('Jedna radka')
    await page.keyboard.press('Enter')
    await page.getByRole('combobox').first().click()
    await expect(page.getByRole('option', { name: 'Nealko' })).toBeVisible()
    await page.getByRole('option', { name: 'Nealko' }).click()

    await page.locator('#product-name').fill(productName)
    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-keyboard.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0JkAAAAASUVORK5CYII=',
        'base64'
      ),
    })
    await page.getByRole('button', { name: 'Vytvořit produkt' }).click()
    await expect(page).toHaveURL(/\/supplier\/stock\?preselect=\d+/)
    await expect(page.getByPlaceholder('ks')).toBeFocused()

    await page.getByPlaceholder('ks').fill('3')
    await page.keyboard.press('Enter')

    const priceField = page.getByPlaceholder('Kč')
    await expect(priceField).toBeFocused()
    await priceField.fill('49')
    await page.keyboard.press('Enter')

    const searchField = page.locator('.p-select-filter')
    await expect(searchField).toBeFocused()
    await searchField.fill(productName)
    await page.keyboard.press('Enter')

    await expect(page.getByRole('combobox').first()).toContainText(productName)

    await page.getByRole('combobox').first().click()
    await expect(searchField).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.getByPlaceholder('ks')).toBeFocused()
  })
})
