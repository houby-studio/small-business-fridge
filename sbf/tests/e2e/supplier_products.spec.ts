import { test, expect } from '@playwright/test'

async function loginAsSupplier(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.locator('#username').fill('supplier')
  await page.locator('#password').fill('supplier123')
  await page.locator('button[type="submit"]').click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Supplier products flow', () => {
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
})
