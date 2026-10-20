import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'
import {
  createIsolatedSupplier,
  loginAsIsolated,
  queryDb,
  type IsolatedSupplier,
} from './helpers/isolated_supplier'

/**
 * A supplier of the test's own with a known set of uninvoiced purchases, so every number on
 * the page is computed here by hand instead of read from the seed (which other tests change):
 *   the supplier itself   1234            = 1 234 Kč (own consumption, shown apart)
 *   Customer User         1000 + 250      = 1 250 Kč (2 purchases)
 *   Second Customer       99              =    99 Kč (1 purchase)
 */
const ORDERS: Array<{ buyer: string; price: number }> = [
  { buyer: 'self', price: 1234 },
  { buyer: 'customer@localhost', price: 1000 },
  { buyer: 'customer@localhost', price: 250 },
  { buyer: 'customer2@localhost', price: 99 },
]

test.describe('Supplier billing page', () => {
  let supplier: IsolatedSupplier

  test.beforeEach(async ({ page }) => {
    supplier = await createIsolatedSupplier('billing')
    const [product] = await queryDb<{ id: number }>(
      `INSERT INTO products (keypad_id, display_name, description, category_id, created_at, updated_at)
       SELECT COALESCE(MAX(keypad_id), 0) + 1, $1, '', (SELECT MIN(id) FROM categories), NOW(), NOW()
       FROM products RETURNING id`,
      [`E2E Fakturace ${Date.now()}`]
    )
    const [delivery] = await queryDb<{ id: number }>(
      `INSERT INTO deliveries (supplier_id, product_id, amount_supplied, amount_left, price,
         created_at, updated_at)
       VALUES ($1, $2, 10, ${10 - ORDERS.length}, 1000, NOW(), NOW()) RETURNING id`,
      [supplier.id, product.id]
    )
    for (const order of ORDERS) {
      await queryDb(
        `INSERT INTO orders (buyer_id, delivery_id, channel, unit_price, created_at, updated_at)
         SELECT CASE WHEN $1 = 'self' THEN $2::int ELSE (SELECT id FROM users WHERE email = $1) END,
           $3, 'web', $4, NOW(), NOW()`,
        [order.buyer, supplier.id, delivery.id, order.price]
      )
    }
    await loginAsIsolated(page, supplier)
  })

  test('is titled like its menu entry, formats money and marks own consumption', async ({
    page,
  }) => {
    await page.goto('/supplier/invoice')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fakturace')

    const table = page.getByTestId('invoice-table')
    // One row per buyer: the supplier and the two customers.
    await expect(table.locator('tbody tr')).toHaveCount(3)
    const ownRow = table.locator('tbody tr', { has: page.getByTestId('invoice-own-consumption') })
    await expect(ownRow).toHaveCount(1)
    await expect(ownRow).toContainText(supplier.name)
    await expect(ownRow.getByTestId('invoice-own-consumption')).toHaveText('vlastní spotřeba')
    // Money in the locale format: a thousands separator, never "1234 Kč".
    await expect(ownRow).toContainText(/1\s234\sKč/)
    await expect(table.locator('tbody tr', { hasText: 'Customer User' })).toContainText(
      /1\s250\sKč/
    )
    await expect(table.locator('tbody tr', { hasText: 'Second Customer' })).toContainText(/99\sKč/)

    // "Celkem" is what colleagues owe — like "Dluží mi" and MCP totalUninvoiced, it leaves
    // the own consumption out and shows it apart: 1000 + 250 + 99 = 1 349 Kč from 2 people
    // in 3 purchases; the own 1 234 Kč under it.
    await expect(page.getByTestId('invoice-kpi-total')).toHaveText(/^1\s349\sKč$/)
    await expect(page.getByTestId('invoice-kpi-customers')).toHaveText('2')
    await expect(page.getByTestId('invoice-kpi-orders')).toHaveText('3')
    await expect(page.getByTestId('invoice-kpi-own')).toContainText(/1\s234\sKč/)

    // The per-row action is a quiet ghost button, not a filled one.
    await expect(ownRow.getByRole('button', { name: 'Vygenerovat fakturu' })).toHaveClass(
      /p-button-text/
    )
  })
})

test.describe('System look', () => {
  test('a focused field has a neutral border, an invalid one stays red', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')
    const barcode = page.locator('#product-barcode')
    await barcode.focus()
    await expect(barcode).toBeFocused()
    // zinc-500 / zinc-400 in dark mode — a grey, not the red primary. Polled: the border
    // colour transitions in.
    await expect
      .poll(() => barcode.evaluate((el) => getComputedStyle(el).borderColor))
      .toMatch(/^rgb\((113, 113, 122|161, 161, 170)\)$/)

    await page.locator('#product-name').fill('x'.repeat(256))
    const name = page.locator('#product-name')
    await expect(name).toBeFocused()
    await expect(name).toHaveClass(/p-invalid/)
    // Still red while focused, so the error is not hidden by the neutral focus colour.
    await expect
      .poll(async () => {
        const border = await name.evaluate((el) => getComputedStyle(el).borderColor)
        const [r, g, b] = border.match(/\d+/g)!.map(Number)
        return r > g + 80 && r > b + 80
      })
      .toBe(true)
  })

  test('table frames are not white in dark mode', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products')
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    const table = page.locator('.p-datatable').first()
    await expect(table).toBeVisible()
    const { border, text } = await table.evaluate((el) => ({
      border: getComputedStyle(el).borderTopColor,
      text: getComputedStyle(el).color,
    }))
    // A neutral line colour (zinc-700), not currentColor — which is the light text colour.
    expect(border).not.toBe(text)
    expect(border).toMatch(/oklch\(0\.37|rgb\(63, 63, 70\)/)
  })
})
