import { test, expect, type Locator, type Page } from '@playwright/test'
import { createProduct, stockPreselected } from './helpers/products'
import {
  createIsolatedSupplier,
  loginAsIsolated,
  queryDb,
  type IsolatedSupplier,
} from './helpers/isolated_supplier'

/**
 * The supplier section on a phone (390 × 844, an iPhone 12-14): nothing may widen the page
 * past the screen, the columns that do not fit are dropped, and every action stays reachable.
 * A table may scroll inside its own box — the page itself must not.
 */

const PHONE = { width: 390, height: 844 }

/** Fails with the offending width rather than a bare `false`. */
async function expectNoHorizontalPageScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(scrollWidth, `page is ${scrollWidth}px wide on a ${innerWidth}px screen`).toBeLessThan(
    innerWidth + 1
  )
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('element has no box (not rendered)')
  return box
}

async function visit(page: Page, url: string) {
  await page.goto(url)
  await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

test.describe('Supplier section on a phone', () => {
  let supplier: IsolatedSupplier

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE)
    supplier = await createIsolatedSupplier('phone')
    await loginAsIsolated(page, supplier)
  })

  // E-M1 — mutation caught: dropping `hidden md:table-cell` from a column, or an action
  // button without its aria-label.
  test('the stock table fits the screen and keeps its row actions', async ({ page }) => {
    // Stocked on a wide screen: the phone draft is E-M2's business.
    await page.setViewportSize({ width: 1366, height: 900 })
    const name = `000 E2E Mobil sklad ${Date.now()}`
    await createProduct(page, name)
    await stockPreselected(page, '4', '20')
    await page.setViewportSize(PHONE)

    await visit(page, '/supplier/stock?scope=mine')
    await expectNoHorizontalPageScroll(page)
    for (const header of ['Prodáno 30 d', 'Naskladněno', 'Hodnota (prodej)']) {
      await expect(page.getByRole('columnheader', { name: header })).toBeHidden()
    }
    await expect(page.getByRole('columnheader', { name: 'Na skladě' })).toBeVisible()

    const row = page.locator('tr', { hasText: name })
    // One menu button instead of three icons — fully on the screen, named for a reader.
    const actions = row.getByTestId('stock-row-actions')
    await expect(actions).toBeInViewport({ ratio: 1 })
    await expect(actions).toHaveAttribute('aria-label', 'Akce')
    await expect(row.getByTestId('stock-row-write-off')).toBeHidden()

    // The menu offers what the row allows, each item on the screen.
    await actions.click()
    for (const [testId, label] of [
      ['stock-menu-receive', 'Naskladnit'],
      ['stock-menu-reprice', 'Změnit cenu'],
      ['stock-menu-write-off', 'Odepsat'],
    ] as const) {
      const item = page.getByTestId(testId)
      await expect(item).toBeInViewport({ ratio: 1 })
      await expect(item).toHaveText(label)
    }

    // Change price from the menu works.
    await page.getByTestId('stock-menu-reprice').click()
    const reprice = page.getByTestId('reprice-dialog')
    await expect(reprice).toContainText(name)
    await expect(reprice.getByTestId('reprice-lot')).toContainText('4 ks')
    await reprice.getByRole('button', { name: 'Zrušit' }).click()

    // The write-off dialog fits the screen too, and its buttons can be reached.
    await actions.click()
    await page.getByTestId('stock-menu-write-off').click()
    const dialog = page.getByTestId('write-off-dialog')
    await expect(dialog).toBeVisible()
    const box = await boxOf(dialog)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width)
    await expect(dialog.getByTestId('write-off-confirm')).toBeInViewport()
  })

  // E-M2 — the whole stocking flow with a thumb: pick, amount, prices, stock. Mutation
  // caught: the footer losing `sticky` (Stock button below the fold) or the product search
  // overlay wider than the screen.
  test('a draft is filled and stocked on a phone', async ({ page }) => {
    const name = `E2E Mobil příjemka ${Date.now()}`
    const productId = await createProduct(page, name)
    // Back to an empty draft; the product is picked by typing, as on the shelf.
    await page.getByTestId('draft-discard').click()
    await page.locator('.p-confirmdialog').getByRole('button', { name: 'Zahodit' }).click()
    // A discarded draft leads back to the stock page (there is no list of drafts).
    await expect(page).toHaveURL(/\/supplier\/stock(\?.*)?$/)

    await visit(page, '/supplier/stock')
    await page.getByTestId('stock-receive').click()
    await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+$/)
    const overlay = page.locator('.p-select-overlay')
    await expect(overlay.locator('.p-select-filter')).toBeFocused()
    const overlayBox = await boxOf(overlay)
    expect(overlayBox.x).toBeGreaterThanOrEqual(0)
    expect(overlayBox.x + overlayBox.width).toBeLessThanOrEqual(PHONE.width)
    await overlay.locator('.p-select-filter').fill(name)
    await page.keyboard.press('Enter')

    const row = page.locator('[data-testid="draft-row"]', { hasText: name })
    const amount = row.getByTestId('draft-row-amount')
    const price = row.getByTestId('draft-row-price')
    await expect(amount).toBeFocused()
    await expect(amount).toBeInViewport()
    await amount.fill('6')
    await price.click()
    await expect(price).toBeInViewport()
    await price.fill('18')
    await price.press('Tab')
    await expect(page.getByTestId('draft-save-state')).toHaveAttribute('data-state', 'saved')
    await expectNoHorizontalPageScroll(page)

    // The amount sits under the product, not beside it: the line is a stack on a phone.
    const productBox = await boxOf(row.getByTestId('draft-row-product'))
    const amountBox = await boxOf(amount)
    expect(amountBox.y).toBeGreaterThanOrEqual(productBox.y + productBox.height)

    const commit = page.getByTestId('draft-commit')
    await expect(commit).toBeInViewport()
    await commit.click()
    await expect(page).toHaveURL(/\/supplier\/stock$/)
    await expect(page.getByText('Naskladněno 6 ks (1 dodávka).')).toBeVisible()
    expect(
      await queryDb(
        'SELECT amount_supplied, price FROM deliveries WHERE product_id = $1 AND supplier_id = $2',
        [productId, supplier.id]
      )
    ).toEqual([{ amount_supplied: 6, price: 18 }])
  })

  // E-M3 — mutation caught: a fixed width (a filter `w-48` row, a KPI grid without `sm:`)
  // widening the page; the tabs not scrolling inside their own strip.
  test('history, inventory, drafts, shopping list and finance fit a phone', async ({ page }) => {
    for (const url of [
      '/supplier/deliveries',
      '/supplier/deliveries?type=adjustments',
      '/supplier/inventory',
      '/supplier/deliveries?type=drafts',
      '/supplier/shopping-list',
      '/supplier/finance',
      '/supplier/products',
      '/supplier/invoice',
      '/supplier/payments',
    ]) {
      await visit(page, url)
      await test.step(url, async () => {
        await expectNoHorizontalPageScroll(page)
        const tabs = page.getByTestId('page-tabs')
        if (await tabs.count()) {
          const box = await boxOf(tabs)
          expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width)
        }
      })
    }

    // The KPI cards of Hospodaření stand under one another.
    await visit(page, '/supplier/finance')
    const cards = page.getByTestId('finance-kpis').locator(':scope > *')
    const count = await cards.count()
    expect(count).toBeGreaterThan(1)
    const lefts = new Set<number>()
    for (let i = 0; i < count; i++) {
      const card = await boxOf(cards.nth(i))
      lefts.add(Math.round(card.x))
    }
    expect([...lefts]).toHaveLength(1)
  })
})
