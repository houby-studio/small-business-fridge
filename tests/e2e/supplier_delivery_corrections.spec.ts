import { test, expect, type Page } from '@playwright/test'
import { loginAsFreshSupplier } from './helpers/isolated_supplier'
import { createProduct, stockPreselected, stockProduct } from './helpers/products'

/**
 * Stocks `productName` again by hand and stops at the commit button, so a test can look at
 * the warning dialog itself (the helpers only confirm a warning they are told to expect).
 */
async function stockAgainWithoutConfirming(
  page: Page,
  productName: string,
  amount: string,
  price: string
) {
  await page.goto('/supplier/stock')
  await page.getByTestId('stock-receive').click()
  await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+/)
  const filter = page.locator('.p-select-overlay .p-select-filter')
  await expect(filter).toBeFocused()
  await filter.fill(productName)
  await page.keyboard.press('Enter')
  const focused = page.locator(':focus')
  await expect(focused).toHaveAttribute('placeholder', 'ks')
  await focused.fill(amount)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.locator(':focus').fill(price)
  await page.keyboard.press('Enter')
  await page.getByTestId('draft-commit').click()
}

test.describe('Supplier delivery corrections', () => {
  test('a repeated stocking asks for confirmation before anything is stocked', async ({ page }) => {
    await loginAsFreshSupplier(page, 'supplier-delivery-co')
    const name = `E2E Duplicita ${Date.now()}`
    const productId = await createProduct(page, name)
    await stockPreselected(page, '3', '49')

    // Same product again right away: the draft is saved, nothing is stocked until confirmed.
    await stockAgainWithoutConfirming(page, name, '3', '49')
    const dialog = page.getByTestId('draft-warning-dialog')
    await expect(dialog).toBeVisible()
    // A quick Enter must not confirm by accident — focus lands on the safe action.
    await expect(dialog.getByTestId('draft-warning-cancel')).toBeFocused()
    await expect(dialog.getByTestId('draft-warning-duplicate')).toContainText('3 ks po 49 Kč/ks')
    await expect(dialog.getByTestId('draft-warning-summary')).toContainText('3 ks po 49 Kč/ks')

    await dialog.getByRole('button', { name: 'Zrušit' }).click()
    await expect(dialog).toBeHidden()
    // The typed line survives the cancel, so the supplier can fix it.
    await expect(page.getByTestId('draft-row-price').first()).toHaveValue('49 Kč')
    await expect(page.getByTestId('draft-row-price').first()).toBeFocused()

    await page.getByTestId('draft-commit').click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Přesto naskladnit' }).click()
    await expect(page).toHaveURL(/\/supplier\/stock$/)
    await expect(page.getByText(/Naskladněno 3 ks/)).toBeVisible()

    await page.goto(`/supplier/deliveries?productId=${productId}`)
    await expect(page.locator('tbody tr')).toHaveCount(2)
  })

  test('supplier can void an unsold duplicate and correct the prices of a delivery', async ({
    page,
  }) => {
    await loginAsFreshSupplier(page, 'supplier-delivery-co')
    const name = `E2E Oprava ${Date.now()}`
    const productId = await createProduct(page, name)
    await stockPreselected(page, '5', '20')
    // The same product again within half an hour: the duplicate warning is expected.
    await stockProduct(page, name, '5', '20', undefined, { expectWarning: true })

    await page.goto(`/supplier/deliveries?productId=${productId}`)
    const rows = page.locator('tbody tr')
    await expect(rows).toHaveCount(2)

    // Void the newer one (the duplicate).
    await rows.first().getByRole('button', { name: 'Stornovat dodávku' }).click()
    const dialog = page.getByTestId('delivery-correction-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('correction-reason')).toBeFocused()
    const voidButton = dialog.getByRole('button', { name: 'Stornovat', exact: true })
    await expect(voidButton).toBeDisabled()
    await dialog.getByTestId('correction-reason').fill('Naskladněno dvakrát')
    await expect(voidButton).toBeEnabled()
    await voidButton.click()

    await expect(page.getByText('Dodávka byla stornována.')).toBeVisible()
    await expect(rows.first().getByTestId('delivery-status-voided')).toBeVisible()
    await expect(rows.first().getByRole('button', { name: 'Opravit dodávku' })).toHaveCount(0)

    // Correct the selling price of the remaining one.
    await rows.nth(1).getByRole('button', { name: 'Opravit dodávku' }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Oprava dodávky · E2E Oprava')

    const saveButton = dialog.getByRole('button', { name: 'Uložit opravu' })
    await expect(saveButton).toBeDisabled()
    await expect(dialog.getByTestId('correction-amount-help')).toHaveText('Lze jen snížit.')

    const priceInput = dialog.getByTestId('correction-price').locator('input')
    await expect(priceInput).toBeFocused()
    await priceInput.fill('25')
    await priceInput.blur()
    await expect(dialog.getByTestId('correction-impact')).toHaveText(
      'Nová cena platí jen pro 5 ks na skladě.'
    )
    await expect(saveButton).toBeDisabled()

    await dialog.getByTestId('correction-reason').fill('Překlep v ceně')
    await expect(saveButton).toBeEnabled()
    await saveButton.click()

    await expect(page.getByText('Dodávka byla opravena.')).toBeVisible()
    const corrected = rows.nth(1)
    // The sub-row says it was corrected and why — no separate status badge.
    await expect(corrected.getByTestId('delivery-status-corrected')).toHaveCount(0)
    await expect(corrected.getByTestId('delivery-last-correction')).toContainText('Překlep v ceně')
    await expect(corrected).toContainText('25 Kč')

    // The purchase price can be recorded afterwards too — on its own it is a change.
    await corrected.getByRole('button', { name: 'Opravit dodávku' }).click()
    await expect(dialog).toBeVisible()
    const purchaseInput = dialog.getByTestId('correction-purchase-price').locator('input')
    await purchaseInput.fill('12,5')
    await purchaseInput.blur()
    await expect(saveButton).toBeDisabled()
    await dialog.getByTestId('correction-reason').fill('Doplněna nákupní cena')
    await expect(saveButton).toBeEnabled()
    await saveButton.click()
    await expect(page.getByText('Dodávka byla opravena.')).toBeVisible()
    await expect(corrected).toContainText('nákup 12,50 Kč')
  })

  test('a corrected price reaches the buyer and the reason opens in a dialog', async ({ page }) => {
    const productName = `E2E Přecenění ${Date.now()}`
    const reason = 'Překlep v ceně – '.repeat(8).trim()

    await loginAsFreshSupplier(page, 'supplier-delivery-co')
    const productId = await createProduct(page, productName)
    await stockPreselected(page, '3', '1')

    // Buy one piece (the supplier shops too), so the correction has a purchase to reprice.
    await page.goto('/shop')
    await page.getByPlaceholder('Hledat...').fill(productName)
    await expect(page.getByText(productName)).toBeVisible()
    await page.getByRole('button', { name: 'Koupit' }).first().click()
    await page.locator('.p-confirmdialog').getByRole('button', { name: 'Koupit' }).click()
    await expect(page.locator('.p-confirmdialog')).toBeHidden()

    await page.goto(`/supplier/deliveries?productId=${productId}`)
    await page.getByRole('button', { name: 'Opravit dodávku' }).first().click()
    const dialog = page.getByTestId('delivery-correction-dialog')
    const priceInput = dialog.getByTestId('correction-price').locator('input')
    await expect(priceInput).toBeFocused()
    // The whole value is selected on open, so typing replaces it instead of appending.
    await page.keyboard.type('25')
    await priceInput.blur()
    await expect(priceInput).toHaveValue('25 Kč')
    await expect(dialog.getByTestId('correction-amount-help')).toContainText('nejméně na 1 ks')
    await expect(dialog.getByTestId('correction-impact')).toContainText(
      '1 ks z nevyfakturovaných nákupů zdraží celkem o 24 Kč'
    )

    await dialog.getByTestId('correction-reason').fill(reason)
    await dialog.getByRole('button', { name: 'Uložit opravu' }).click()
    await expect(page.getByText(/Dodávka byla opravena/)).toBeVisible()

    await page.goto('/orders')
    const row = page.locator('tbody tr', { hasText: productName })
    await expect(row.getByTestId('order-price-corrected')).toContainText('Cena opravena')
    await expect(row.getByTestId('order-price-corrected')).toContainText('původně 1 Kč')
    // The free-text reason must not be rendered inline — it would break the table.
    await expect(row).not.toContainText('Překlep v ceně')

    await row.getByRole('button', { name: 'Detail opravy ceny' }).click()
    const detail = page.getByTestId('order-price-correction-dialog')
    await expect(detail).toBeVisible()
    await expect(detail).toContainText(reason)
    await expect(detail).toContainText('25 Kč')
    await detail.getByRole('button', { name: 'Zavřít' }).last().click()
    await expect(detail).toBeHidden()
  })
})
