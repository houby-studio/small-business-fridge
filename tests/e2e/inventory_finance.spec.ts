import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'
import { createIsolatedSupplier, loginAsIsolated } from './helpers/isolated_supplier'
import { commitDraft, createProduct, stockPreselected } from './helpers/products'

test.describe('Supplier purchase price, shrinkage and earnings', () => {
  test('the purchase price suggests the selling price', async ({ page }) => {
    await loginAsIsolated(page, await createIsolatedSupplier('finance'))
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
    // A supplier of its own: the shared one's stock grows with every test, and "000" rows of
    // other tests would push this one off the first page.
    await loginAsIsolated(page, await createIsolatedSupplier('shrinkage'))
    // Leading zeros sort it first in the stock table.
    const name = `000 E2E Inventura ${Date.now()}`
    const productId = await createProduct(page, name)
    await stockPreselected(page, '5', '20')

    await page.goto('/supplier/stock?scope=mine')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    const row = page.locator('tr', { hasText: name })
    await row.getByTestId('stock-row-write-off').click()
    const dialog = page.getByTestId('write-off-dialog')
    await expect(dialog).toBeVisible()
    // The product is named in the header, the stock under the quantity, which has the focus.
    await expect(dialog).toContainText(`Odepsat zboží · ${name}`)
    await expect(dialog.getByTestId('write-off-stock')).toHaveText('skladem 5 ks')
    await expect(dialog.locator('#write-off-quantity')).toBeFocused()
    await page.keyboard.type('1')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Odepsáno 1 ks.')).toBeVisible()

    await page.goto('/supplier/inventory')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await expect(page.getByTestId('tab-inventory')).toHaveAttribute('aria-current', 'page')
    const sheetRow = page.getByTestId(`inventory-row-${productId}`)
    await expect(sheetRow).toContainText('v systému 4 ks')
    await sheetRow.locator(`#inventory-counted-${productId}`).fill('2')
    await sheetRow.locator(`#inventory-counted-${productId}`).press('Enter')
    await expect(page.getByTestId(`inventory-diff-${productId}`)).toHaveText('\u22122')

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

    // The shortfall starts without a reason; the earnings page points to where it is given.
    const detailUrl = page.url()
    await page.goto('/supplier/finance')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await expect(page.getByTestId('finance-reason-inventory-link')).toHaveAttribute(
      'href',
      '/supplier/deliveries?type=adjustments&scope=mine&reason=inventory'
    )
    await page.goto(detailUrl)
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    // The supplier knows the pieces were stolen.
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
    // With shrinkage on the books, the margin dialog offers the margin that covers it —
    // never a lower one than the set margin (UX-26).
    await page.getByTestId('finance-margin-edit').click()
    await expect(page.getByTestId('finance-break-even')).toContainText('pokryje manko')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('finance-history-link')).toHaveAttribute(
      'href',
      '/supplier/deliveries?type=adjustments&scope=mine'
    )
  })

  test('buying from your own stock is own consumption, not a sale', async ({ page }) => {
    await loginAsIsolated(page, await createIsolatedSupplier('finance'))
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
    // One quiet line says where the money is; what is owed links to Invoicing and Payments.
    await expect(page.getByTestId('finance-money')).toContainText('Nakoupeno')
    await expect(page.getByTestId('finance-money-stock')).toContainText('Na skladě')
    await expect(page.getByTestId('finance-money-uninvoiced')).toHaveAttribute(
      'href',
      '/supplier/invoice'
    )
    await expect(page.getByTestId('finance-money-unpaid')).toHaveAttribute(
      'href',
      '/supplier/payments'
    )

    await page.getByRole('button', { name: 'Nastavení marže' }).click()
    const dialog = page.getByTestId('finance-margin-dialog')
    await expect(dialog).toBeVisible()
    // A fresh supplier has no shrinkage, so there is no break-even margin to offer.
    await expect(dialog.getByTestId('finance-break-even')).toHaveCount(0)
    await expect(dialog.getByTestId('finance-margin-help')).toContainText('0 % = za nákupní cenu')
    const margin = dialog.getByTestId('finance-margin')
    const before = (await margin.textContent())!.trim()

    // The value field has the focus and Enter saves (UX-09).
    await expect(dialog.locator('#finance-margin-input')).toBeFocused()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('7,5')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await page.getByTestId('finance-margin-edit').click()
    await expect(margin).toHaveText('7,5 %')

    await dialog.locator('#finance-margin-input').fill(before.replace(/\s*%$/, ''))
    await dialog.getByTestId('finance-margin-save').click()
    await expect(dialog).toBeHidden()
    await page.getByTestId('finance-margin-edit').click()
    await expect(margin).toHaveText(before)
  })

  test('a counted sheet survives filters and a reload, and leaving it asks first (UX-01)', async ({
    page,
  }) => {
    await loginAsIsolated(page, await createIsolatedSupplier('finance'))
    const name = `000 E2E Arch ${Date.now()}`
    const productId = await createProduct(page, name)
    await stockPreselected(page, '3', '20')

    await page.goto('/supplier/inventory')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    const input = page.locator(`#inventory-counted-${productId}`)
    await input.fill('2')
    await input.press('Enter')
    // Enter moves on to the next count (or the save button), it does not submit anything.
    await expect(input).not.toBeFocused()
    await expect(page.getByTestId(`inventory-diff-${productId}`)).toHaveText('\u22121')
    await expect(page.getByTestId(`inventory-row-${productId}`)).toHaveClass(/bg-green-50/)

    // Another category hides the product, but its count is kept and still sent.
    await page.getByTestId('inventory-category').click()
    await page.getByRole('option', { name: 'Sladkosti' }).click()
    await expect(page).toHaveURL(/categoryId=/)
    await expect(page.getByTestId(`inventory-row-${productId}`)).toHaveCount(0)
    await expect(page.getByTestId('inventory-outside-filter')).toContainText('1 spočítaný produkt')
    await expect(page.getByTestId('inventory-commit')).toBeEnabled()

    // A reload (the phone locked, the tab reloaded) keeps the sheet of this tab.
    await page.goto('/supplier/inventory')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await expect(input).toHaveValue('2')

    // Leaving through a tab asks before the counts are thrown away.
    await page.getByTestId('tab-stock-state').click()
    const confirm = page.locator('.p-confirmdialog')
    await expect(confirm).toContainText('Zahodit rozpočítanou inventuru?')
    await confirm.getByRole('button', { name: 'Zrušit' }).click()
    await expect(page).toHaveURL(/\/supplier\/inventory/)
    await expect(input).toHaveValue('2')
    await page.getByTestId('tab-stock-state').click()
    await confirm.getByRole('button', { name: 'Zahodit a odejít' }).click()
    await expect(page).toHaveURL(/\/supplier\/stock/)

    await page.goto('/supplier/inventory')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await expect(input).toHaveValue('')
  })

  test('the sheet runs by category with headings, and Enter follows it (P3)', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/inventory?scope=all')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)

    const headings = page.getByTestId('inventory-category-heading')
    await expect(headings.first()).toBeVisible()
    const texts = await headings.allTextContents()
    const names = texts.map((text) => text.trim())
    expect(names.length).toBeGreaterThan(1)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'cs')))
    expect(new Set(names).size).toBe(names.length)

    // Enter moves to the next count in the sheet's order, across a category heading too.
    const inputs = page.locator('[data-testid="inventory-sheet"] input[id^="inventory-counted-"]')
    const ids = await inputs.evaluateAll((els) => els.map((el) => el.id))
    await page.locator(`#${ids[0]}`).fill('1')
    for (let i = 1; i < Math.min(ids.length, 6); i++) {
      await page.keyboard.press('Enter')
      await expect(page.locator(`#${ids[i]}`)).toBeFocused()
    }
  })

  test('a mistaken write-off is taken back from the history (F3)', async ({ page }) => {
    // A supplier of its own: the shared one's stock grows with every test, and "000" rows of
    // other tests would push this one off the first page.
    await loginAsIsolated(page, await createIsolatedSupplier('shrinkage'))
    const name = `000 E2E Vrácení ${Date.now()}`
    await createProduct(page, name)
    await stockPreselected(page, '3', '20')

    await page.goto('/supplier/stock?scope=mine')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await page.locator('tr', { hasText: name }).getByTestId('stock-row-write-off').click()
    await expect(page.locator('#write-off-quantity')).toBeFocused()
    await page.keyboard.type('2')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Odepsáno 2 ks.')).toBeVisible()

    await page.goto('/supplier/deliveries?type=adjustments&scope=mine')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    const row = page.locator('tr', { hasText: name })
    await row.getByRole('button', { name: `Vrátit odpis: ${name}` }).click()
    const confirm = page.locator('.p-confirmdialog')
    await expect(confirm).toContainText('2 ks')
    await confirm.getByRole('button', { name: 'Vrátit odpis' }).click()
    await expect(page.getByText('Odpis vrácen, 2 ks je zpět na skladě.')).toBeVisible()
    await expect(row.getByTestId('adjustment-reverted')).toHaveText('Vráceno')
    await expect(row.getByTestId('adjustment-quantity')).toHaveClass(/line-through/)
    await expect(row.getByTestId('adjustment-revert')).toHaveCount(0)

    await page.goto('/supplier/stock?scope=mine')
    await expect(page.locator('tr', { hasText: name })).toContainText('3')
  })

  test('the inventory is a tab of the stock page and explains itself behind an info hint', async ({
    page,
  }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/inventory')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sklad')
    await expect(page.getByTestId('tab-inventory')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('tab-stock-state')).not.toHaveAttribute('aria-current')
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

    // The tab carries the scope this page shows (its default "Celá lednice") over to Stav.
    await page.getByTestId('tab-stock-state').click()
    await expect(page).toHaveURL(/\/supplier\/stock\?scope=all$/)
    await expect(page.getByTestId('tab-stock-state')).toHaveAttribute('aria-current', 'page')
  })
})
