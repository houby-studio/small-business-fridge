import { test, expect } from '@playwright/test'
import { loginAsFreshSupplier } from './helpers/isolated_supplier'
import { createProduct, stockPreselected } from './helpers/products'

test.describe('Stock history (Sklad › Historie)', () => {
  test('on a phone the row actions stay on screen and the date moves under the product', async ({
    page,
  }) => {
    await loginAsFreshSupplier(page, 'delivery-history')
    const name = `E2E Mobil historie ${Date.now()}`
    const productId = await createProduct(page, name)
    await stockPreselected(page, '4', '30')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/supplier/deliveries?productId=${productId}`)
    const row = page.getByTestId('history-deliveries').locator('tbody tr').first()
    await expect(row).toContainText(name)

    await expect(row.getByTestId('delivery-correct')).toBeInViewport()
    await expect(row.getByTestId('delivery-void')).toBeInViewport()
    // The date column is hidden; the date itself is still there, under the product name.
    await expect(page.getByTestId('history-deliveries').locator('th.sbf-col-date')).toBeHidden()
    await expect(row.locator('td').first()).toContainText(/\d{2}\. ?\d{2}\./)
  })

  test('the correction dialog asks for the purchase price first and Enter saves it', async ({
    page,
  }) => {
    await loginAsFreshSupplier(page, 'delivery-history')
    const name = `E2E Enter oprava ${Date.now()}`
    const productId = await createProduct(page, name)
    await stockPreselected(page, '4', '30')

    await page.goto(`/supplier/deliveries?productId=${productId}`)
    await page.getByRole('button', { name: 'Opravit dodávku' }).first().click()
    const dialog = page.getByTestId('delivery-correction-dialog')
    await expect(dialog).toBeVisible()

    // Same order as the stocking draft: amount · purchase price · selling price.
    await expect(dialog.locator('label')).toHaveText([
      /množství/i,
      /Nákupní cena/,
      /Prodejní cena/,
      /Důvod/,
    ])

    await dialog.getByTestId('correction-reason').fill('Překlep v ceně')
    const price = dialog.getByTestId('correction-price').locator('input')
    await price.fill('32')
    await price.press('Enter')

    await expect(dialog).toBeHidden()
    await expect(page.getByText('Dodávka byla opravena.')).toBeVisible()
    await expect(page.getByTestId('history-deliveries').locator('tbody tr').first()).toContainText(
      '32 Kč'
    )
  })
})
