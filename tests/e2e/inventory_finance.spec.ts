import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'
import { commitDraft, createProduct, stockPreselected } from './helpers/products'

test.describe('Supplier purchase price, shrinkage and earnings', () => {
  test('the purchase price suggests the selling price', async ({ page }) => {
    await loginAs(page, 'supplier')
    await createProduct(page, `E2E Nákupka ${Date.now()}`)

    // The product form lands on the draft with the amount focused.
    const focused = page.locator(':focus')
    await expect(focused).toHaveAttribute('placeholder', 'ks')
    await focused.fill('5')
    await page.keyboard.press('Enter')
    await expect(page.locator(':focus')).toHaveAttribute('placeholder', 'Kč')
    await page.locator(':focus').fill('19,9')
    await page.keyboard.press('Enter')

    // The selling price is shown as a suggestion (purchase price + margin, rounded up);
    // Enter accepts it as the real value.
    const price = page.locator(':focus')
    await expect(price).toHaveAttribute('data-testid', 'draft-row-price')
    await expect(price).toHaveAttribute('placeholder', 'návrh 20 Kč')
    await expect(price).toHaveValue('')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('draft-row-price').first()).toHaveValue('20 Kč')
    // Enter in the price opens the next line's product search; close it before stocking.
    await page.keyboard.press('Escape')
    await commitDraft(page)
    await expect(page.getByText('Naskladněno 5 ks (1 dodávka).')).toBeVisible()
  })

  test('a write-off and an inventory record the shrinkage', async ({ page }) => {
    await loginAs(page, 'supplier')
    // Leading zeros sort it first in the stock table.
    const name = `000 E2E Inventura ${Date.now()}`
    const productId = await createProduct(page, name)
    await stockPreselected(page, '5', '20')

    await page.goto('/supplier/stock')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    const row = page.locator('tr', { hasText: name })
    await row.getByTestId('stock-row-write-off').click()
    const dialog = page.getByTestId('write-off-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('write-off-hint')).toContainText(
      'rozbité, prošlé nebo odcizené'
    )
    await dialog.locator('#write-off-quantity').fill('1')
    await dialog.getByTestId('write-off-confirm').click()
    await expect(page.getByText('Odepsáno 1 ks.')).toBeVisible()

    await page.goto('/supplier/inventory')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await expect(page.getByTestId('tab-inventory')).toHaveAttribute('aria-selected', 'true')
    const sheetRow = page.getByTestId(`inventory-row-${productId}`)
    await expect(sheetRow).toContainText('v systému 4 ks')
    await sheetRow.locator(`#inventory-counted-${productId}`).fill('2')
    await sheetRow.locator(`#inventory-counted-${productId}`).press('Enter')
    await expect(page.getByTestId(`inventory-diff-${productId}`)).toHaveText('-2')

    await page.getByTestId('inventory-commit').click()
    const confirm = page.locator('.p-confirmdialog')
    await expect(confirm).toContainText('Odepsat 2 ks jako manko a vrátit 0 ks na sklad?')
    await confirm.getByRole('button', { name: 'Uložit inventuru' }).click()
    await expect(page).toHaveURL(/\/supplier\/inventory\/\d+$/)
    // The differences table names the product; the affected lots are folded away.
    await expect(page.getByRole('cell', { name, exact: true })).toHaveCount(1)
    await expect(page.getByTestId('count-lots')).toHaveCount(0)
    await page.getByTestId('count-lots-toggle').click()
    await expect(page.getByTestId('count-lots')).toContainText(name)
    // Without a purchase price the selling price stands in for both values.
    await expect(page.getByTestId('count-loss-cost')).toHaveText('40 Kč')
    await expect(page.getByTestId('count-loss-value')).toHaveText('40 Kč')

    // The shortfall starts without a reason; the supplier knows the pieces were stolen.
    const reason = page.getByTestId(`count-reason-${productId}`)
    await expect(reason).toContainText('Zatím bez důvodu')
    await reason.click()
    await page.getByRole('option', { name: 'Odcizené' }).click()
    await expect(page.getByText(`Důvod manka uložen: ${name} — Odcizené.`)).toBeVisible()

    await page.reload()
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await expect(page.getByTestId(`count-reason-${productId}`)).toContainText('Odcizené')

    // The earnings page breaks the shrinkage down by reason and links to the write-off history.
    await page.goto('/supplier/finance')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await expect(page.getByTestId('finance-reason-stolen')).toContainText('Odcizené')
    await expect(page.getByTestId('finance-reason-expired')).toContainText('Prošlé')
    // With shrinkage on the books, the margin dialog offers the margin that covers it.
    await page.getByTestId('finance-margin-edit').click()
    await expect(page.getByTestId('finance-break-even')).toContainText('pokryje manko')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('finance-history-link')).toHaveAttribute(
      'href',
      '/supplier/deliveries?type=adjustments&scope=mine'
    )
  })

  test('buying from your own stock is own consumption, not a sale', async ({ page }) => {
    await loginAs(page, 'supplier')
    const name = `E2E Vlastní spotřeba ${Date.now()}`
    await createProduct(page, name)
    await stockPreselected(page, '3', '17')

    await page.goto('/supplier/finance')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    const revenue = page.getByTestId('finance-revenue')
    await expect(revenue).toBeVisible()
    const revenueBefore = (await revenue.textContent())!.trim()
    const own = page.getByTestId('finance-own-consumption')
    const ownBefore = (await own.count())
      ? Number((await own.textContent())!.match(/(\d+) ks/)![1])
      : 0

    await page.goto('/shop')
    await page.getByPlaceholder('Hledat...').fill(name)
    await page
      .locator('.sbf-card', { hasText: name })
      .getByRole('button', { name: 'Koupit' })
      .click()
    await page.locator('.p-confirmdialog').getByRole('button', { name: 'Koupit' }).click()
    await expect(page.locator('.p-confirmdialog')).toBeHidden()

    await page.goto('/supplier/finance')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await expect(own).toContainText(`Vlastní spotřeba ${ownBefore + 1} ks`)
    await expect(own).toContainText('mimo tržby')
    await expect(revenue).toHaveText(revenueBefore)
  })

  test('the margin is a setting behind the cog on the earnings page', async ({ page }) => {
    // The admin (who has supplier access) keeps the supplier's margin untouched for other tests.
    await loginAs(page, 'admin')
    await page.goto('/supplier/finance')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    const kpis = page.getByTestId('finance-kpis')
    await expect(kpis).toBeVisible()
    await expect(kpis).toContainText('Manko v nákupních cenách')
    await expect(kpis).toContainText('Čistý zisk')
    // The margin is no card on the page any more.
    await expect(page.getByTestId('finance-margin')).toHaveCount(0)

    await page.getByRole('button', { name: 'Nastavení marže' }).click()
    const dialog = page.getByTestId('finance-margin-dialog')
    await expect(dialog).toBeVisible()
    // A fresh supplier has no shrinkage, so there is no break-even margin to offer.
    await expect(dialog.getByTestId('finance-break-even')).toHaveCount(0)
    await expect(dialog.getByTestId('finance-margin-help')).toContainText('0 % = za nákupní cenu')
    const margin = dialog.getByTestId('finance-margin')
    const before = (await margin.textContent())!.trim()

    await dialog.locator('#finance-margin-input').fill('7,5')
    await dialog.getByTestId('finance-margin-save').click()
    await expect(dialog).toBeHidden()
    await page.getByTestId('finance-margin-edit').click()
    await expect(margin).toHaveText('7,5 %')

    await dialog.locator('#finance-margin-input').fill(before.replace(/\s*%$/, ''))
    await dialog.getByTestId('finance-margin-save').click()
    await expect(dialog).toBeHidden()
    await page.getByTestId('finance-margin-edit').click()
    await expect(margin).toHaveText(before)
  })

  test('the inventory is a tab of the stock page and explains itself behind an info hint', async ({
    page,
  }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/inventory')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sklad')
    await expect(page.getByTestId('tab-inventory')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('tab-stock-state')).toHaveAttribute('aria-selected', 'false')
    // No paragraph under the heading: the explanation waits behind the (i).
    await expect(page.getByText('Spočítej kusy v lednici')).toHaveCount(0)
    await expect(page.getByText('nejstarších dodávek')).toHaveCount(0)
    await page.getByTestId('inventory-commit-hint').click()
    await expect(page.getByRole('dialog')).toContainText('nejstarších dodávek')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // Past inventories default to the supplier's own; everyone's on request.
    await expect(page.getByTestId('inventory-who')).toContainText('Jen moje')
    await page.getByTestId('inventory-who').click()
    await page.getByRole('option', { name: 'Všichni' }).click()
    await expect(page).toHaveURL(/who=all/)

    await page.getByTestId('tab-stock-state').click()
    await expect(page).toHaveURL(/\/supplier\/stock$/)
    await expect(page.getByTestId('tab-stock-state')).toHaveAttribute('aria-selected', 'true')
  })
})
