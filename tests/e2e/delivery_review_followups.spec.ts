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
  await page.locator('#product-description').fill('E2E review follow-up')
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Nealko' }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'e2e-followup.png',
    mimeType: 'image/png',
    buffer: PIXEL_PNG,
  })
  await page.getByRole('button', { name: 'Vytvořit produkt' }).click()
  await expect(page).toHaveURL(/\/supplier\/stock\?preselect=\d+/)
  return page.url().match(/preselect=(\d+)/)![1]
}

async function stock(page: Page, amount: string, price: string) {
  await page.getByPlaceholder('ks').fill(amount)
  await page.keyboard.press('Enter')
  await page.getByPlaceholder('Kč').fill(price)
  await page.keyboard.press('Enter')
}

test.describe('Delivery review follow-ups', () => {
  test('an unusual price is flagged and Esc returns to the price field', async ({ page }) => {
    await loginAs(page, 'supplier')
    const productId = await createProduct(page, `E2E Cena ${Date.now()}`)
    await stock(page, '3', '20')
    await expect(page.getByText('Naskladněno 3 ks za 20 Kč/ks.')).toBeVisible()

    await page.goto(`/supplier/stock?preselect=${productId}`)
    await stock(page, '3', '200')
    const dialog = page.getByTestId('delivery-warning-dialog')
    await expect(dialog.getByTestId('delivery-warning-price')).toContainText('20 Kč/ks')

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.getByPlaceholder('Kč')).toBeFocused()
  })

  test('the Supplier column follows the applied scope filter', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/deliveries')
    const supplierHeader = page.getByRole('columnheader', { name: 'Dodavatel' })
    await expect(supplierHeader).toHaveCount(0)

    await page.getByTestId('deliveries-scope').click()
    await page.getByRole('option', { name: 'Celý sklad' }).click()
    // Not applied yet — the table still shows the old rows, so no column either.
    await expect(supplierHeader).toHaveCount(0)

    await page.getByRole('button', { name: 'Použít filtry' }).click()
    await expect(supplierHeader).toBeVisible()
  })

  test("a supplier's Activity names the admin who voided their delivery", async ({
    page,
    browser,
  }) => {
    await loginAs(page, 'supplier')
    const productName = `E2E Aktivita ${Date.now()}`
    const productId = await createProduct(page, productName)
    await stock(page, '2', '15')
    await expect(page.getByText('Naskladněno 2 ks za 15 Kč/ks.')).toBeVisible()

    const adminContext = await browser.newContext()
    const admin = await adminContext.newPage()
    await loginAs(admin, 'admin')
    await admin.goto(`/supplier/deliveries?scope=store&productId=${productId}`)
    await admin.getByRole('button', { name: 'Stornovat naskladnění' }).first().click()
    const dialog = admin.getByTestId('delivery-correction-dialog')
    await dialog.getByTestId('correction-reason').fill('Kontrola admina')
    await dialog.getByRole('button', { name: 'Stornovat', exact: true }).click()
    await expect(admin.getByText('Naskladnění bylo stornováno.')).toBeVisible()
    await adminContext.close()

    await page.goto('/audit')
    const row = page.locator('tbody tr', { hasText: 'Storno naskladnění' }).first()
    await expect(row.getByTestId('audit-foreign-actor')).toHaveText('Admin User')
  })

  test('a price changed while the shop was open is confirmed in a modal, not a toast', async ({
    page,
    browser,
  }) => {
    await loginAs(page, 'supplier')
    const productName = `E2E Modal ${Date.now()}`
    const productId = await createProduct(page, productName)
    await stock(page, '3', '20')
    await expect(page.getByText('Naskladněno 3 ks za 20 Kč/ks.')).toBeVisible()

    // The customer opens the shop and sees the product at 20 Kč.
    const customerContext = await browser.newContext()
    const customer = await customerContext.newPage()
    await loginAs(customer, 'customer')
    await customer.goto('/shop')
    await customer.getByPlaceholder('Hledat...').fill(productName)
    await expect(customer.getByText('20 Kč')).toBeVisible()

    // Meanwhile the supplier corrects the price.
    await page.goto(`/supplier/deliveries?productId=${productId}`)
    await page.getByRole('button', { name: 'Opravit naskladnění' }).first().click()
    const correction = page.getByTestId('delivery-correction-dialog')
    await page.keyboard.type('22')
    await correction.getByTestId('correction-reason').fill('Nová cena')
    await correction.getByRole('button', { name: 'Uložit opravu' }).click()
    await expect(page.getByText(/Naskladnění bylo opraveno/)).toBeVisible()

    // The customer buys from the stale page: nothing is bought, a modal asks.
    await customer.getByRole('button', { name: 'Koupit' }).first().click()
    await customer.locator('.p-confirmdialog').getByRole('button', { name: 'Koupit' }).click()
    const modal = customer.getByTestId('price-changed-dialog')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('z 20 Kč na 22 Kč')
    await expect(modal.getByTestId('price-changed-cancel')).toBeFocused()

    await modal.getByTestId('price-changed-buy').click()
    await expect(modal).toBeHidden()
    await customer.goto('/orders')
    await expect(customer.locator('tbody tr', { hasText: productName })).toContainText('22 Kč')
    await customerContext.close()
  })
})
