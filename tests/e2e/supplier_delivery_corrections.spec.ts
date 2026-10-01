import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './helpers/auth'

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAGCAYAAADkOT91AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVR4nGM4IafxHxkz0EIAAMbhMTmfCC9yAAAAAElFTkSuQmCC',
  'base64'
)

/** Create an own product so the seeded catalogue and its stock stay untouched. */
async function createProduct(page: Page, name: string): Promise<string> {
  await page.goto('/supplier/products/new')
  await page.locator('#product-name').fill(name)
  await page.locator('#product-description').fill('E2E oprava naskladnění')
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Nealko' }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'e2e-correction.png',
    mimeType: 'image/png',
    buffer: PIXEL_PNG,
  })
  await page.getByRole('button', { name: 'Vytvořit produkt' }).click()
  await expect(page).toHaveURL(/\/supplier\/stock\?preselect=\d+/)
  return page.url().match(/preselect=(\d+)/)![1]
}

/** Keyboard flow of the quick form: InputNumber commits its value on Enter. */
async function stock(page: Page, amount: string, price: string) {
  await page.getByPlaceholder('ks').fill(amount)
  await page.keyboard.press('Enter')
  await page.getByPlaceholder('Kč').fill(price)
  await page.keyboard.press('Enter')
}

test.describe('Supplier delivery corrections', () => {
  test('a repeated delivery asks for confirmation before stocking', async ({ page }) => {
    await loginAs(page, 'supplier')
    const productId = await createProduct(page, `E2E Duplicita ${Date.now()}`)

    await stock(page, '3', '49')
    await expect(page.getByText('Naskladněno 3 ks za 49 Kč/ks.')).toBeVisible()

    // Same product again right away: nothing is stored until the supplier confirms.
    await page.goto(`/supplier/stock?preselect=${productId}`)
    await stock(page, '3', '49')
    const dialog = page.getByTestId('delivery-warning-dialog')
    await expect(dialog).toBeVisible()
    // A quick Enter must not confirm by accident — focus lands on the safe action.
    await expect(dialog.getByTestId('delivery-warning-edit')).toBeFocused()
    await expect(dialog.getByTestId('delivery-warning-duplicate')).toContainText('3 ks po 49 Kč/ks')

    await dialog.getByRole('button', { name: 'Upravit údaje' }).click()
    await expect(dialog).toBeHidden()
    // The typed values survive the cancel, so the supplier can fix them.
    await expect(page.getByPlaceholder('Kč')).toHaveValue('49 Kč')

    await page.getByPlaceholder('Kč').press('Enter')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Přesto naskladnit' }).click()
    await expect(dialog).toBeHidden()

    await page.goto(`/supplier/deliveries?productId=${productId}`)
    await expect(page.locator('tbody tr')).toHaveCount(2)
  })

  test('supplier can void an unsold duplicate and correct the price of a delivery', async ({
    page,
  }) => {
    await loginAs(page, 'supplier')
    const productId = await createProduct(page, `E2E Oprava ${Date.now()}`)

    await stock(page, '5', '20')
    await expect(page.getByText('Naskladněno 5 ks za 20 Kč/ks.')).toBeVisible()
    await page.goto(`/supplier/stock?preselect=${productId}`)
    await stock(page, '5', '20')
    await page.getByRole('button', { name: 'Přesto naskladnit' }).click()
    await expect(page.getByTestId('delivery-warning-dialog')).toBeHidden()

    await page.goto(`/supplier/deliveries?productId=${productId}`)
    const rows = page.locator('tbody tr')
    await expect(rows).toHaveCount(2)

    // Void the newer one (the duplicate).
    await rows.first().getByRole('button', { name: 'Stornovat naskladnění' }).click()
    const dialog = page.getByTestId('delivery-correction-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('correction-reason')).toBeFocused()
    const voidButton = dialog.getByRole('button', { name: 'Stornovat', exact: true })
    await expect(voidButton).toBeDisabled()
    await dialog.getByTestId('correction-reason').fill('Naskladněno dvakrát')
    await expect(voidButton).toBeEnabled()
    await voidButton.click()

    await expect(page.getByText('Naskladnění bylo stornováno.')).toBeVisible()
    await expect(rows.first().getByTestId('delivery-status-voided')).toBeVisible()
    await expect(rows.first().getByRole('button', { name: 'Opravit naskladnění' })).toHaveCount(0)

    // Correct the price of the remaining one.
    await rows.nth(1).getByRole('button', { name: 'Opravit naskladnění' }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Oprava naskladnění · E2E Oprava')

    const saveButton = dialog.getByRole('button', { name: 'Uložit opravu' })
    await expect(saveButton).toBeDisabled()
    await expect(dialog.getByTestId('correction-amount-help')).toHaveText('Lze jen snížit.')

    const priceInput = dialog.getByRole('spinbutton').nth(1)
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

    await expect(page.getByText('Naskladnění bylo opraveno.')).toBeVisible()
    const corrected = rows.nth(1)
    await expect(corrected.getByTestId('delivery-status-corrected')).toBeVisible()
    await expect(corrected.getByTestId('delivery-last-correction')).toContainText('Překlep v ceně')
    await expect(corrected).toContainText('25 Kč')
  })

  test('a corrected price reaches the buyer and the reason opens in a dialog', async ({ page }) => {
    const productName = `E2E Přecenění ${Date.now()}`
    const reason = 'Překlep v ceně – '.repeat(8).trim()

    await loginAs(page, 'supplier')
    const productId = await createProduct(page, productName)
    await stock(page, '3', '1')
    await expect(page.getByText('Naskladněno 3 ks za 1 Kč/ks.')).toBeVisible()

    // Buy one piece (the supplier shops too), so the correction has a purchase to reprice.
    await page.goto('/shop')
    await page.getByPlaceholder('Hledat...').fill(productName)
    await expect(page.getByText(productName)).toBeVisible()
    await page.getByRole('button', { name: 'Koupit' }).first().click()
    await page.locator('.p-confirmdialog').getByRole('button', { name: 'Koupit' }).click()
    await expect(page.locator('.p-confirmdialog')).toBeHidden()

    await page.goto(`/supplier/deliveries?productId=${productId}`)
    await page.getByRole('button', { name: 'Opravit naskladnění' }).first().click()
    const dialog = page.getByTestId('delivery-correction-dialog')
    const priceInput = dialog.getByRole('spinbutton').nth(1)
    await expect(priceInput).toBeFocused()
    // The whole value is selected on open, so typing replaces it instead of appending.
    await page.keyboard.type('25')
    await priceInput.blur()
    await expect(priceInput).toHaveValue('25 Kč')
    await expect(dialog.getByTestId('correction-amount-help')).toContainText(
      'nejméně na 1 ks (už prodáno)'
    )
    await expect(dialog.getByTestId('correction-impact')).toContainText(
      '1 ks z nevyfakturovaných nákupů zdraží celkem o 24 Kč'
    )

    await dialog.getByTestId('correction-reason').fill(reason)
    await dialog.getByRole('button', { name: 'Uložit opravu' }).click()
    await expect(page.getByText(/Naskladnění bylo opraveno/)).toBeVisible()

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
