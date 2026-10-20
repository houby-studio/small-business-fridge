import { test, expect, type Browser, type Page } from '@playwright/test'
import { loginAs } from './helpers/auth'
import { createProduct, stockPreselected } from './helpers/products'
import {
  createIsolatedSupplier,
  loginAsIsolated,
  queryDb,
  type IsolatedSupplier,
} from './helpers/isolated_supplier'

/**
 * Hardening of the stock pages: the inventory sheet while the fridge keeps selling, the
 * sheet's filter and leave behaviour, and the actions that change the price or the pieces of
 * a lot. Each test is a supplier of its own, so the inventory sheet ("Jen moje") lists only
 * the products the test stocked.
 */

/** A product of the supplier's own, stocked with `pieces` at `price` Kč; returns its id. */
async function stockedProduct(page: Page, label: string, pieces: string, price: string) {
  // Leading zeros sort it onto the first page of the stock table.
  const name = `000 E2E ${label} ${Date.now()}`
  const productId = await createProduct(page, name)
  await stockPreselected(page, pieces, price)
  return { name, productId }
}

/** A customer buys one piece in the shop, in a browser of their own. */
async function customerBuysOne(browser: Browser, productName: string) {
  const context = await browser.newContext({ locale: 'cs-CZ' })
  const shop = await context.newPage()
  try {
    await loginAs(shop, 'customer')
    await shop.goto('/shop')
    await expect(shop.locator('#sbf-boot-loader')).toHaveCount(0)
    await shop.getByPlaceholder('Hledat...').fill(productName)
    await shop
      .locator('.sbf-card', { hasText: productName })
      .getByRole('button', { name: 'Koupit' })
      .click()
    await shop.locator('.p-confirmdialog').getByRole('button', { name: 'Koupit' }).click()
    await expect(shop.locator('.p-confirmdialog')).toBeHidden()
  } finally {
    await context.close()
  }
  // The order is in the database before the test goes on.
  await expect
    .poll(async () => {
      const [orders] = await queryDb<{ n: string }>(
        `SELECT COUNT(*) AS n FROM orders o JOIN deliveries d ON d.id = o.delivery_id
         WHERE d.product_id = (SELECT id FROM products WHERE display_name = $1)`,
        [productName]
      )
      return orders.n
    })
    .toBe('1')
}

async function lotsOf(productId: number) {
  return queryDb<{ amount_left: number; amount_lost: number; price: number }>(
    `SELECT amount_left, amount_lost, price FROM deliveries
     WHERE product_id = $1 AND voided_at IS NULL ORDER BY id`,
    [productId]
  )
}

async function adjustmentsOf(productId: number) {
  return queryDb<{ kind: string; quantity: number; reverted_at: Date | null }>(
    `SELECT a.kind, a.quantity, a.reverted_at FROM stock_adjustments a
     JOIN deliveries d ON d.id = a.delivery_id WHERE d.product_id = $1 ORDER BY a.id`,
    [productId]
  )
}

async function openInventory(page: Page) {
  await page.goto('/supplier/inventory')
  await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
}

async function commitInventory(page: Page, question: string) {
  await page.getByTestId('inventory-commit').click()
  const confirm = page.locator('.p-confirmdialog')
  await expect(confirm).toContainText(question)
  await confirm.getByRole('button', { name: 'Uložit inventuru' }).click()
  await expect(page).toHaveURL(/\/supplier\/inventory\/\d+$/)
}

test.describe('Stock hardening', () => {
  let supplier: IsolatedSupplier

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
    supplier = await createIsolatedSupplier('stock')
    await loginAsIsolated(page, supplier)
  })

  // PRO-05/BE-01 through the browser. Sheet read at 3 (asOf), a customer buys one, the
  // supplier then counts 2: the fridge is right — 3 − 1 sold before counting = 2 — so there
  // is no shortfall. Mutation caught: the page sending `asOf` = the moment of commit (or no
  // `asOf`), which would write the sold piece off a second time as a loss.
  test('a piece sold after the sheet loaded but before counting is no shortfall', async ({
    page,
    browser,
  }) => {
    const { name, productId } = await stockedProduct(page, 'Prodej před počítáním', '3', '20')
    await openInventory(page)
    await expect(page.getByTestId(`inventory-row-${productId}`)).toContainText('v systému 3 ks')

    await customerBuysOne(browser, name)

    const input = page.locator(`#inventory-counted-${productId}`)
    await input.fill('2')
    await input.press('Enter')
    await commitInventory(page, 'Odepsat 1 ks jako manko a vrátit 0 ks na sklad?')

    // The server moved the expected stock on by the sale: nothing differs.
    await expect(page.getByText('Všechno sedělo, žádné rozdíly.')).toBeVisible()
    expect(await adjustmentsOf(productId)).toEqual([])
    expect(await lotsOf(productId)).toEqual([{ amount_left: 2, amount_lost: 0, price: 20 }])
  })

  // The other side of the clock: counted 3 while 3 were there, a customer buys one before the
  // supplier presses "Uložit". The count stands (no difference) and the sale stays sold: 2
  // left, not 3. Mutation caught: `countedAt` taken at commit time instead of when the number
  // was typed — the sale would look earlier than the count and +1 would be put back.
  test('a piece sold after counting but before saving stays sold', async ({ page, browser }) => {
    const { name, productId } = await stockedProduct(page, 'Prodej po počítání', '3', '20')
    await openInventory(page)
    const input = page.locator(`#inventory-counted-${productId}`)
    await input.fill('3')
    await input.press('Enter')
    await expect(page.getByTestId(`inventory-diff-${productId}`)).toHaveText('0')

    await customerBuysOne(browser, name)

    await commitInventory(page, 'Odepsat 0 ks jako manko a vrátit 0 ks na sklad?')
    await expect(page.getByText('Všechno sedělo, žádné rozdíly.')).toBeVisible()
    expect(await adjustmentsOf(productId)).toEqual([])
    expect(await lotsOf(productId)).toEqual([{ amount_left: 2, amount_lost: 0, price: 20 }])
  })

  // UX-01: the count hidden by the category filter is not only kept on screen — it is the
  // one that gets saved. Mutation caught: posting only the products currently shown.
  test('a count hidden by the category filter is saved with the inventory', async ({ page }) => {
    const { name, productId } = await stockedProduct(page, 'Skrytý filtrem', '4', '20')
    await openInventory(page)
    const input = page.locator(`#inventory-counted-${productId}`)
    await input.fill('1')
    await input.press('Enter')

    await page.getByTestId('inventory-category').click()
    await page.getByRole('option', { name: 'Sladkosti' }).click()
    await expect(page).toHaveURL(/categoryId=/)
    await expect(page.getByTestId(`inventory-row-${productId}`)).toHaveCount(0)

    // 4 in the system, 1 counted: 3 short.
    await commitInventory(page, 'Odepsat 3 ks jako manko a vrátit 0 ks na sklad?')
    await expect(page.getByRole('cell', { name, exact: true })).toHaveCount(1)
    expect(await lotsOf(productId)).toEqual([{ amount_left: 1, amount_lost: 3, price: 20 }])
    expect(await adjustmentsOf(productId)).toEqual([
      { kind: 'loss', quantity: 3, reverted_at: null },
    ])
  })

  // UX-01 guard through the main menu and the browser's own history. Mutation caught: the
  // `before` guard removed (the menu would drop the sheet silently), or the sheet not kept in
  // session storage (Back + Forward would come back empty).
  test('the inventory sheet asks before the menu drops it and survives Back/Forward', async ({
    page,
  }) => {
    const { productId } = await stockedProduct(page, 'Arch v menu', '3', '20')
    await openInventory(page)
    const input = page.locator(`#inventory-counted-${productId}`)
    await input.fill('2')
    await input.press('Enter')

    const menuToStock = async () => {
      await page.locator('.sbf-nav').getByText('Dodavatel', { exact: true }).click()
      await page.locator('.sbf-nav a[href="/supplier/stock"]').click()
    }
    const confirm = page.locator('.p-confirmdialog')

    await menuToStock()
    await expect(confirm).toContainText('Máte spočítaný 1 produkt.')
    await confirm.getByRole('button', { name: 'Zrušit' }).click()
    await expect(page).toHaveURL(/\/supplier\/inventory$/)
    await expect(input).toHaveValue('2')

    // The browser's Back is not an Inertia visit the page can hold; the sheet waits instead.
    await page.goBack()
    await expect(page).not.toHaveURL(/\/supplier\/inventory/)
    await page.goForward()
    await expect(page).toHaveURL(/\/supplier\/inventory$/)
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await expect(input).toHaveValue('2')

    await menuToStock()
    await confirm.getByRole('button', { name: 'Zahodit a odejít' }).click()
    await expect(page).toHaveURL(/\/supplier\/stock/)
    await openInventory(page)
    await expect(input).toHaveValue('')
    // Nothing was saved on the way.
    expect(await adjustmentsOf(productId)).toEqual([])
  })

  // PRO-02: the dialog and the change cover the supplier's own pieces only. A colleague holds
  // 3 more pieces of the same product at the same price. Mutation caught: the dialog counting
  // `totalRemaining` (8) or the service repricing every lot of the product.
  test("a new price applies to the supplier's own pieces, not a colleague's", async ({ page }) => {
    const { name, productId } = await stockedProduct(page, 'Sleva jen moje', '5', '20')
    const colleague = await createIsolatedSupplier('colleague')
    await queryDb(
      `INSERT INTO deliveries (supplier_id, product_id, amount_supplied, amount_left, price,
         created_at, updated_at)
       VALUES ($1, $2, 3, 3, 20, NOW(), NOW())`,
      [colleague.id, productId]
    )

    // "Celá lednice" lists every supplier's products, 20 a page: a category of the test's own
    // keeps the row on the first one however many "000 E2E" products other tests left.
    const [category] = await queryDb<{ id: number }>(
      `INSERT INTO categories (name, color, is_disabled, created_at, updated_at)
       VALUES ($1, '#6b7280', false, NOW(), NOW()) RETURNING id`,
      [`E2E Kategorie ${Date.now()}`]
    )
    await queryDb('UPDATE products SET category_id = $1 WHERE id = $2', [category.id, productId])
    await page.goto(`/supplier/stock?scope=all&categoryId=${category.id}`)
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    const row = page.locator('tr', { hasText: name })
    await expect(row.locator('td').nth(1)).toHaveText(/^8 ks/)
    await expect(row.getByTestId('stock-mixed')).toHaveText('z toho moje 5')
    await row.getByTestId('stock-row-reprice').click()
    const dialog = page.getByTestId('reprice-dialog')
    // Both lots are listed, oldest first; only mine has a price field.
    const lots = dialog.getByTestId('reprice-lot')
    await expect(lots).toHaveCount(2)
    await expect(lots.nth(0).getByTestId('reprice-lot-price')).toBeVisible()
    await expect(lots.nth(1).getByTestId('reprice-lot-readonly')).toHaveText('20 Kč')
    await expect(lots.nth(1).getByTestId('reprice-lot-price')).toHaveCount(0)
    await page.keyboard.type('16')
    await page.keyboard.press('Enter')
    await expect(dialog.getByTestId('reprice-summary')).toHaveText(
      'Změní se 1 dodávka · 5 ks na skladě'
    )
    await dialog.getByTestId('reprice-confirm').click()
    await expect(page.getByText('Cena změněna u 1 dodávky (5 ks na skladě).')).toBeVisible()

    // Own lot first (stocked first), the colleague's untouched.
    expect(await lotsOf(productId)).toEqual([
      { amount_left: 5, amount_lost: 0, price: 16 },
      { amount_left: 3, amount_lost: 0, price: 20 },
    ])
  })

  // F3: the write-off goes back onto the very lot it came from. 3 stocked, 2 written off → 1
  // left; reverted → 3 left, 0 lost. (The older test only looks for a "3" somewhere in the
  // row, which the timestamp in the product name satisfies on its own.)
  test('a reverted write-off puts exactly its pieces back on the lot', async ({ page }) => {
    const { name, productId } = await stockedProduct(page, 'Vrácení přesně', '3', '20')
    await page.goto('/supplier/stock?scope=mine')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    const row = page.locator('tr', { hasText: name })
    await row.getByTestId('stock-row-write-off').click()
    await expect(page.locator('#write-off-quantity')).toBeFocused()
    await page.keyboard.type('2')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Odepsáno 2 ks.')).toBeVisible()
    // (Reload the narrowed view so the assertion reads fresh props.)
    await page.goto('/supplier/stock?scope=mine')
    await expect(row.locator('td').nth(1)).toHaveText('1 ks')
    expect(await lotsOf(productId)).toEqual([{ amount_left: 1, amount_lost: 2, price: 20 }])

    await page.goto(`/supplier/deliveries?type=adjustments&scope=mine&productId=${productId}`)
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await page.getByRole('button', { name: `Vrátit odpis: ${name}` }).click()
    await page.locator('.p-confirmdialog').getByRole('button', { name: 'Vrátit odpis' }).click()
    await expect(page.getByText('Odpis vrácen, 2 ks je zpět na skladě.')).toBeVisible()

    expect(await lotsOf(productId)).toEqual([{ amount_left: 3, amount_lost: 0, price: 20 }])
    const [adjustment] = await adjustmentsOf(productId)
    expect(adjustment.reverted_at).not.toBeNull()
    await page.goto('/supplier/stock?scope=mine')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await expect(page.locator('tr', { hasText: name }).locator('td').nth(1)).toHaveText('3 ks')
  })

  // BUG (reported): `writeOff` in inventory_controller.ts answers `redirect().back()`, which
  // drops the query string — after a write-off the page falls back to "Celá lednice", page 1,
  // no category, and the row the supplier just worked on may not be on it. CLAUDE.md:
  // `redirect('back', true)`. Mutation caught: the same for any action of the stock page.
  test('a write-off keeps the filters of the stock page', async ({ page }) => {
    const { name } = await stockedProduct(page, 'Odpis filtry', '3', '20')
    await page.goto('/supplier/stock?scope=mine&sortBy=productName&sortOrder=desc')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await page.locator('tr', { hasText: name }).getByTestId('stock-row-write-off').click()
    await expect(page.locator('#write-off-quantity')).toBeFocused()
    await page.keyboard.type('1')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Odepsáno 1 ks.')).toBeVisible()
    await expect(page).toHaveURL(/\?scope=mine&sortBy=productName&sortOrder=desc$/)
    await expect(page.getByTestId('stock-scope')).toContainText('Jen moje')
  })
})
