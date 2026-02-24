import { test, expect } from '@playwright/test'

async function loginAsSupplier(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.locator('#username').fill('supplier')
  await page.locator('#password').fill('supplier123')
  await page.locator('button[type="submit"]').click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Supplier products flow', () => {
  test('create and edit pages expose keyboard-friendly name inputs', async ({ page }) => {
    const productName = `E2E Fokus ${Date.now()}`

    await loginAsSupplier(page)
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

    await loginAsSupplier(page)
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

    await loginAsSupplier(page)
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
