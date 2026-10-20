import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'
import { createProduct, stockPreselected } from './helpers/products'
import { createIsolatedSupplier, loginAsIsolated, queryDb } from './helpers/isolated_supplier'

/**
 * UI standards and input guards of the supplier section, checked across pages instead of one
 * sentence at a time: no explaining paragraph under a page title, every icon-only button
 * named for screen readers, invalid input stopped in the browser with a visible reason, and
 * a refusal by the server shown without throwing the user's input away.
 */

const SUPPLIER_PAGES = [
  '/supplier/stock',
  '/supplier/deliveries',
  '/supplier/deliveries?type=adjustments',
  '/supplier/inventory',
  '/supplier/deliveries?type=drafts',
  '/supplier/shopping-list',
  '/supplier/products',
  '/supplier/product-groups',
  '/supplier/finance',
  '/supplier/invoice',
  '/supplier/payments',
]

test.describe('Supplier UI standards', () => {
  // E-U1 — the seeded supplier has deliveries, invoices and lists, so the row actions render.
  // Mutation caught: an icon Button without `:aria-label`, a `<p>` put back under an `h1`.
  test('no paragraph under the heading and every icon-only button is labelled', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
    await loginAs(page, 'supplier')
    for (const url of SUPPLIER_PAGES) {
      await page.goto(url)
      await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      const problems = await page.evaluate(() => {
        const found: string[] = []
        const h1 = document.querySelector('h1')!
        if (h1.nextElementSibling?.tagName === 'P') {
          found.push(`<p> right under the h1: ${h1.nextElementSibling.textContent?.trim()}`)
        }
        // A header row (h1 + its buttons) followed by a paragraph is the same thing.
        const header = h1.parentElement
        if (header && header.tagName !== 'MAIN' && header.children.length <= 4) {
          const after = header.nextElementSibling
          if (after?.tagName === 'P')
            found.push(`<p> under the header: ${after.textContent?.trim()}`)
        }
        for (const button of Array.from(
          document.querySelectorAll<HTMLElement>('button, [role="button"]')
        )) {
          const rect = button.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) continue
          if ((button.textContent ?? '').trim()) continue
          const label =
            button.getAttribute('aria-label') ?? button.getAttribute('aria-labelledby') ?? ''
          if (!label.trim()) found.push(`unlabelled icon button: ${button.outerHTML.slice(0, 160)}`)
        }
        return found
      })
      expect(problems, url).toEqual([])
    }
  })
})

test.describe('Supplier input guards', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
  })

  // E-V1, write-off: 3 pieces on the shelf. Mutation caught: dropping the min/max check from
  // `writeOffError` (the button would send 0 or 9 to the server).
  test('the write-off dialog refuses nothing and more than the stock', async ({ page }) => {
    const supplier = await createIsolatedSupplier('writeoff')
    await loginAsIsolated(page, supplier)
    const name = `000 E2E Odpis meze ${Date.now()}`
    const productId = await createProduct(page, name)
    await stockPreselected(page, '3', '20')

    await page.goto('/supplier/stock?scope=mine')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await page.locator('tr', { hasText: name }).getByTestId('stock-row-write-off').click()
    const dialog = page.getByTestId('write-off-dialog')
    const quantity = dialog.locator('#write-off-quantity')
    const confirm = dialog.getByTestId('write-off-confirm')
    await expect(quantity).toBeFocused()

    await page.keyboard.press('Control+a')
    await page.keyboard.press('Backspace')
    await expect(dialog.locator('small')).toHaveText('Zadejte aspoň 1 kus.')
    await expect(confirm).toBeDisabled()

    // More than in stock is shown as typed and explained in place (no InputNumber max: it
    // used to swallow the digit and move the focus away).
    await page.keyboard.type('9')
    await expect(quantity).toHaveValue('9')
    await expect(quantity).toBeFocused()
    await expect(dialog.locator('small')).toHaveText('Skladem je jen 3 ks.')
    await expect(confirm).toBeDisabled()

    // A valid amount is taken while typing — no need to leave the field.
    await page.keyboard.press('Backspace')
    await page.keyboard.type('3')
    await expect(dialog.getByTestId('write-off-stock')).toHaveText('skladem 3 ks')
    await expect(confirm).toBeEnabled()
    // Nothing reached the server on the way.
    expect(
      await queryDb('SELECT amount_left, amount_lost FROM deliveries WHERE product_id = $1', [
        productId,
      ])
    ).toEqual([{ amount_left: 3, amount_lost: 0 }])
  })

  // BUG-E5 (fixed): a number past the stock used to be refused with the focus leaving the
  // field, and a corrected number was only taken on blur, so Enter did nothing. Now the
  // field keeps the focus, says why, and the corrected number is sent with Enter.
  test('after a refused digit the write-off is corrected and sent in place', async ({ page }) => {
    const supplier = await createIsolatedSupplier('writeofffocus')
    await loginAsIsolated(page, supplier)
    const name = `000 E2E Odpis fokus ${Date.now()}`
    const productId = await createProduct(page, name)
    await stockPreselected(page, '3', '20')
    await page.goto('/supplier/stock?scope=mine')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await page.locator('tr', { hasText: name }).getByTestId('stock-row-write-off').click()
    const dialog = page.getByTestId('write-off-dialog')
    const quantity = dialog.locator('#write-off-quantity')
    await expect(quantity).toBeFocused()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('9')
    await expect(quantity).toBeFocused()
    await expect(dialog.locator('small')).toHaveText('Skladem je jen 3 ks.')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('2')
    await expect(dialog.getByTestId('write-off-stock')).toHaveText('skladem 3 ks')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Odepsáno 2 ks.')).toBeVisible()
    expect(
      await queryDb('SELECT amount_left, amount_lost FROM deliveries WHERE product_id = $1', [
        productId,
      ])
    ).toEqual([{ amount_left: 1, amount_lost: 2 }])
  })

  // E-V1, server side: two tabs see 3 pieces; the second writes all 3 off, the first then
  // asks for 2. The server refuses (NOT_ENOUGH_STOCK) — the supplier must see that and keep
  // the dialog with what they typed, as the reprice dialog already does.
  test('a write-off the server refuses keeps the dialog open with the typed amount', async ({
    page,
    context,
  }) => {
    const supplier = await createIsolatedSupplier('writeoffrace')
    await loginAsIsolated(page, supplier)
    const name = `000 E2E Odpis souběh ${Date.now()}`
    const productId = await createProduct(page, name)
    await stockPreselected(page, '3', '20')

    await page.goto('/supplier/stock?scope=mine')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await page.locator('tr', { hasText: name }).getByTestId('stock-row-write-off').click()
    const dialog = page.getByTestId('write-off-dialog')
    await expect(dialog.locator('#write-off-quantity')).toBeFocused()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('2')

    const other = await context.newPage()
    await other.setViewportSize({ width: 1366, height: 900 })
    await other.goto('/supplier/stock?scope=mine')
    await expect(other.locator('#sbf-boot-loader')).toHaveCount(0)
    await other.locator('tr', { hasText: name }).getByTestId('stock-row-write-off').click()
    await expect(other.locator('#write-off-quantity')).toBeFocused()
    await other.keyboard.press('Control+a')
    await other.keyboard.type('3')
    await other.keyboard.press('Enter')
    await expect(other.getByText('Odepsáno 3 ks.')).toBeVisible()
    await other.close()

    await dialog.getByTestId('write-off-confirm').click()
    await expect(page.locator('.p-toast-message-error')).toBeVisible()
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('#write-off-quantity')).toHaveValue('2')
    expect(
      await queryDb('SELECT amount_left, amount_lost FROM deliveries WHERE product_id = $1', [
        productId,
      ])
    ).toEqual([{ amount_left: 0, amount_lost: 3 }])
  })

  // E-V1, draft: a third decimal of the purchase price cannot be typed — 14,999 ends up as
  // 14,99 Kč on the screen and in the database, not as an error or a rounded 15.
  test('a purchase price takes two decimals and is stored as shown', async ({ page }) => {
    const supplier = await createIsolatedSupplier('decimals')
    await loginAsIsolated(page, supplier)
    const name = `E2E Haléře ${Date.now()}`
    const productId = await createProduct(page, name)
    const row = page.locator('[data-testid="draft-row"]', { hasText: name })
    const purchase = row.getByTestId('draft-row-purchase-price')
    await purchase.click()
    await page.keyboard.type('14,999')
    await purchase.press('Tab')
    await expect(purchase).toHaveValue('14,99 Kč')
    await row.getByTestId('draft-row-price').fill('25')
    await row.getByTestId('draft-row-price').press('Tab')
    await expect(page.getByTestId('draft-save-state')).toHaveAttribute('data-state', 'saved')
    await page.getByTestId('draft-commit').click()
    await expect(page).toHaveURL(/\/supplier\/stock$/)
    expect(
      await queryDb('SELECT purchase_price, price FROM deliveries WHERE product_id = $1', [
        productId,
      ])
    ).toEqual([{ purchase_price: '14.99', price: 25 }])
  })

  // E-V1, margin: 100 % is the most the server accepts. Typed 150 must be pointed out where
  // it was typed — the field keeps the focus, says why, Save stays disabled, and Enter does
  // not close the dialog as if it had saved.
  // BUG-E5 (fixed): typing 150 used to move the focus onto the dialog's close button and
  // snap the field to 100 %, so the next Enter closed the dialog unsaved.
  test('a margin over 100 % is refused in place and Enter does not close the dialog', async ({
    page,
  }) => {
    const supplier = await createIsolatedSupplier('margin')
    await loginAsIsolated(page, supplier)
    await page.goto('/supplier/finance')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await page.getByTestId('finance-margin-edit').click()
    const dialog = page.getByTestId('finance-margin-dialog')
    const input = dialog.locator('#finance-margin-input')
    await expect(input).toBeFocused()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('150')

    await expect(dialog.locator('small')).toHaveText('Zadejte číslo od 0 do 100.')
    await expect(dialog.getByTestId('finance-margin-save')).toBeDisabled()
    await expect(input).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
    await expect(input).toBeFocused()

    // The boundary itself is accepted.
    await page.keyboard.press('Control+a')
    await page.keyboard.type('100')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect
      .poll(async () => {
        const [user] = await queryDb<{ margin_percent: string }>(
          'SELECT margin_percent FROM users WHERE id = $1',
          [supplier.id]
        )
        return user.margin_percent
      })
      .toBe('100.00')
  })
})
