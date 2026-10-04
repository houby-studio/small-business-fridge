import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'
import { commitDraft, createProduct, stockPreselected } from './helpers/products'

test.describe('Delivery review follow-ups', () => {
  test('an unusual price is flagged at commit and Esc returns to the price field', async ({
    page,
  }) => {
    await loginAs(page, 'supplier')
    const name = `E2E Cena ${Date.now()}`
    await createProduct(page, name)
    await stockPreselected(page, '3', '20')

    // Ten times the last price: the server flags the line before anything is stocked.
    await page.goto('/supplier/stock')
    await page.getByTestId('stock-receive').click()
    const filter = page.locator('.p-select-overlay .p-select-filter')
    await expect(filter).toBeFocused()
    await filter.fill(name)
    await page.keyboard.press('Enter')
    // The last prices come along as values, so the keyboard flow can Enter through them.
    await expect(page.getByTestId('draft-row-purchase-price').first()).toHaveValue('')
    await expect(page.getByTestId('draft-row-price').first()).toHaveValue('20 Kč')
    await page.locator(':focus').fill('3')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.locator(':focus').fill('200')
    await page.keyboard.press('Enter')
    await page.getByTestId('draft-commit').click()

    const dialog = page.getByTestId('draft-warning-dialog')
    await expect(dialog.getByTestId('draft-warning-price')).toContainText('20 Kč/ks')
    await expect(dialog.getByTestId('draft-warning-price')).toContainText('vy,')
    await expect(dialog.getByTestId('draft-warning-cancel')).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    const price = page.getByTestId('draft-row-price').first()
    await expect(price).toHaveValue('200 Kč')
    await expect(price).toBeFocused()

    await commitDraft(page)
  })

  test('the Supplier column follows the applied scope filter', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/deliveries')
    const supplierHeader = page.getByRole('columnheader', { name: 'Dodavatel' })
    await expect(supplierHeader).toHaveCount(0)

    await page.getByTestId('deliveries-scope').click()
    await page.getByRole('option', { name: 'Celá lednice' }).click()
    // Not applied yet — the table still shows the old rows, so no column either.
    await expect(supplierHeader).toHaveCount(0)

    await page.getByRole('button', { name: 'Použít filtry' }).click()
    await expect(supplierHeader).toBeVisible()
    await expect(page).toHaveURL(/scope=all/)
  })

  test("a supplier's Activity names the admin who voided their delivery", async ({
    page,
    browser,
  }) => {
    await loginAs(page, 'supplier')
    const productName = `E2E Aktivita ${Date.now()}`
    const productId = await createProduct(page, productName)
    await stockPreselected(page, '2', '15')

    const adminContext = await browser.newContext()
    const admin = await adminContext.newPage()
    await loginAs(admin, 'admin')
    await admin.goto(`/supplier/deliveries?scope=all&productId=${productId}`)
    await admin.getByRole('button', { name: 'Stornovat dodávku' }).first().click()
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
    await stockPreselected(page, '3', '20')

    // The customer opens the shop and sees the product at 20 Kč.
    const customerContext = await browser.newContext()
    const customer = await customerContext.newPage()
    await loginAs(customer, 'customer')
    await customer.goto('/shop')
    await customer.getByPlaceholder('Hledat...').fill(productName)
    await expect(customer.getByText('20 Kč')).toBeVisible()

    // Meanwhile the supplier corrects the price.
    await page.goto(`/supplier/deliveries?productId=${productId}`)
    await page.getByRole('button', { name: 'Opravit dodávku' }).first().click()
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
