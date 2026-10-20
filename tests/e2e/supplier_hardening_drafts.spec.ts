import { test, expect, type Page } from '@playwright/test'
import { commitDraft, createProduct, discardDraft } from './helpers/products'
import {
  createIsolatedSupplier,
  loginAsIsolated,
  queryDb,
  type IsolatedSupplier,
} from './helpers/isolated_supplier'

/**
 * Hardening of the stocking draft (příjemka): what happens to the supplier's data when saves
 * race with stocking, fail, or land on a draft that another tab has closed. Every test works
 * as a supplier of its own, so a draft or badge count of another test cannot leak in.
 */

const DRAFT_PUT = /\/supplier\/stock\/drafts\/\d+$/

/** A product of the supplier's own on an open draft with one complete line (amount 1, price). */
async function draftWithPricedLine(page: Page, supplier: IsolatedSupplier, price: string) {
  await loginAsIsolated(page, supplier)
  const name = `E2E Tvrdá příjemka ${Date.now()}`
  const productId = await createProduct(page, name)
  const row = page.locator('[data-testid="draft-row"]', { hasText: name })
  await row.getByTestId('draft-row-price').fill(price)
  await row.getByTestId('draft-row-price').press('Tab')
  await expect(page.getByTestId('draft-save-state')).toHaveAttribute('data-state', 'saved')
  return { name, productId, row, draftUrl: page.url().split('?')[0] }
}

/** Every delivery of the product as the database has it — one row per lot. */
async function deliveriesOf(productId: number) {
  return queryDb<{ amount_supplied: number; price: number; voided_at: Date | null }>(
    `SELECT amount_supplied, price, voided_at FROM deliveries WHERE product_id = $1 ORDER BY id`,
    [productId]
  )
}

test.describe('Stocking draft under pressure', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
  })

  // E-A4 — mutation caught: commit() stocking `lastSaved`/the server's lines instead of the
  // page's current payload, or a second Ctrl+Enter getting past the `submitting` guard.
  test('Ctrl+Enter right after typing stocks the typed amount, once', async ({ page }) => {
    const supplier = await createIsolatedSupplier('ctrlenter')
    const { productId, row } = await draftWithPricedLine(page, supplier, '20')

    // No Tab, no pause: the autosave of "9" has not even been scheduled to run yet.
    await row.getByTestId('draft-row-amount').click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('9')
    await page.keyboard.press('Control+Enter')
    await page.keyboard.press('Control+Enter')

    await expect(page).toHaveURL(/\/supplier\/stock$/)
    // 9 pieces × 1 line, the text of `messages.stock_draft_committed`.
    await expect(page.getByText('Naskladněno 9 ks (1 dodávka).')).toBeVisible()
    await expect(page.locator('.p-toast-message-error')).toHaveCount(0)
    expect(await deliveriesOf(productId)).toEqual([
      { amount_supplied: 9, price: 20, voided_at: null },
    ])
  })

  // E-A4 — mutation caught: commit() not waiting for a save in flight (`if (saveInFlight)`
  // removed): the commit then races the PUT, the version moves under it and nothing (or the
  // older amount) is stocked.
  test('stocking while a save is in flight waits for it and stocks the latest amount', async ({
    page,
  }) => {
    const supplier = await createIsolatedSupplier('inflight')
    const { productId, row } = await draftWithPricedLine(page, supplier, '20')

    // The next save is held on the wire until the test lets it go.
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let held = 0
    await page.route(DRAFT_PUT, async (route) => {
      if (route.request().method() === 'PUT' && held++ === 0) await gate
      await route.continue()
    })

    const amount = row.getByTestId('draft-row-amount')
    await amount.fill('9')
    await amount.press('Tab')
    await expect(page.getByTestId('draft-save-state')).toHaveAttribute('data-state', 'saving')

    // A further change and Ctrl+Enter while "9" is still on its way.
    await amount.fill('10')
    await page.keyboard.press('Control+Enter')
    // Nothing is stocked while the save is held.
    await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+/)
    expect(await deliveriesOf(productId)).toEqual([])

    release()
    await expect(page).toHaveURL(/\/supplier\/stock$/)
    await expect(page.getByText('Naskladněno 10 ks (1 dodávka).')).toBeVisible()
    await expect(page.locator('.p-toast-message-error')).toHaveCount(0)
    expect(await deliveriesOf(productId)).toEqual([
      { amount_supplied: 10, price: 20, voided_at: null },
    ])
  })

  // E-A1 through the menu (the existing test leaves through the page's own back arrow) and an
  // HTTP 500 instead of a dropped connection. Mutation caught: the navigation guard replaying
  // the visit after a failed save (QA-03 a) — the supplier would leave without being asked.
  test('a save the server rejects with 500 holds a menu navigation and asks first', async ({
    page,
  }) => {
    const supplier = await createIsolatedSupplier('save500')
    const { row, draftUrl } = await draftWithPricedLine(page, supplier, '20')
    const save = page.getByTestId('draft-save-state')

    await page.route(DRAFT_PUT, (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 500, body: 'boom' })
        : route.continue()
    )
    await row.getByTestId('draft-row-amount').fill('8')
    await row.getByTestId('draft-row-amount').press('Tab')
    await expect(save).toHaveAttribute('data-state', 'error')
    await expect(save).toHaveText(/Uložení selhalo/)
    // The draft stays usable: no error modal over it.
    await expect(page.locator('iframe')).toHaveCount(0)

    await page.locator('.sbf-nav').getByText('Dodavatel', { exact: true }).click()
    await page.locator('.sbf-nav a[href="/supplier/stock"]').click()
    const confirm = page.locator('.p-confirmdialog')
    await expect(confirm).toContainText('Poslední změny se nepodařilo uložit')
    await confirm.getByRole('button', { name: 'Zrušit' }).click()
    // The product form landed on `?focus=<line>`; the page keeps that query.
    await expect(page).toHaveURL(new RegExp(`^${draftUrl}(\\?|$)`))
    await expect(row.getByTestId('draft-row-amount')).toHaveValue('8')

    // Leaving anyway really leaves without the change: the server still has amount 1.
    await page.locator('.sbf-nav').getByText('Dodavatel', { exact: true }).click()
    await page.locator('.sbf-nav a[href="/supplier/stock"]').click()
    await confirm.getByRole('button', { name: 'Odejít bez uložení' }).click()
    await expect(page).toHaveURL(/\/supplier\/stock(\?.*)?$/)
    await page.unroute(DRAFT_PUT)
    await page.goto(draftUrl)
    await expect(
      page
        .locator('[data-testid="draft-row"]', { hasText: 'E2E Tvrdá příjemka' })
        .getByTestId('draft-row-amount')
    ).toHaveValue('1')
    await page.keyboard.press('Escape')
    await discardDraft(page)
  })

  // QA-03 (b) — mutation caught: treating the DRAFT_CLOSED flash as a successful save (the
  // footer would say "Uloženo" over a draft that no longer takes changes).
  test('a draft stocked in another tab is shown closed, not "saved"', async ({ page, context }) => {
    const supplier = await createIsolatedSupplier('closed')
    const { productId, row, draftUrl } = await draftWithPricedLine(page, supplier, '20')

    // The second tab stocks the draft as it is (1 piece).
    const other = await context.newPage()
    await other.goto(draftUrl)
    await expect(other.locator('#sbf-boot-loader')).toHaveCount(0)
    await other.keyboard.press('Escape')
    await commitDraft(other)
    await other.close()

    // The first tab does not know yet and edits on.
    await row.getByTestId('draft-row-amount').fill('5')
    await row.getByTestId('draft-row-amount').press('Tab')
    await expect(page.getByText('Příjemka už byla naskladněna nebo zahozena.')).toBeVisible()
    await expect(page.getByTestId('draft-closed')).toContainText('Příjemka byla naskladněna')
    // A closed draft has no save state and no Stock button — nothing claims "Uloženo".
    await expect(page.getByTestId('draft-save-state')).toHaveCount(0)
    await expect(page.getByTestId('draft-commit')).toHaveCount(0)
    expect(await deliveriesOf(productId)).toEqual([
      { amount_supplied: 1, price: 20, voided_at: null },
    ])
  })

  // E-A5 — the menu badge counts open drafts with lines; it should follow the draft the
  // supplier is filling, not wait for the next full page load.
  test('the menu badge appears once the first line of an empty draft is saved', async ({
    page,
  }) => {
    const supplier = await createIsolatedSupplier('badge')
    await loginAsIsolated(page, supplier)
    const name = `E2E Badge prázdná ${Date.now()}`
    await createProduct(page, name)
    // Back to no draft with lines at all.
    await page.keyboard.press('Escape')
    await discardDraft(page)
    // The menu's "Sklad" carries no badge while there is no draft with lines.
    await page.locator('.sbf-nav').getByText('Dodavatel', { exact: true }).click()
    await expect(page.locator('.sbf-nav a[href="/supplier/stock"]')).toBeVisible()
    await expect(page.getByTestId('nav-stock-badge')).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.goto('/supplier/stock')
    await page.getByTestId('stock-receive').click()
    await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+$/)
    const filter = page.locator('.p-select-overlay .p-select-filter')
    await expect(filter).toBeFocused()
    await filter.fill(name)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('draft-save-state')).toHaveAttribute('data-state', 'saved')
    const [openLines] = await queryDb<{ n: string }>(
      `SELECT COUNT(*) AS n FROM stock_draft_items i JOIN stock_drafts d ON d.id = i.stock_draft_id
       WHERE d.supplier_id = $1 AND d.status = 'open'`,
      [supplier.id]
    )
    // The line is on the server — what the badge counts.
    expect(openLines.n).toBe('1')

    await page.locator('.sbf-nav').getByText('Dodavatel', { exact: true }).click()
    await expect(page.getByTestId('nav-stock-badge')).toHaveText('1')
    await page.keyboard.press('Escape')
    await discardDraft(page)
  })

  // E-W1 — the helper no longer confirms a warning nobody expected; here it is spelled out:
  // a brand-new product has no history, so stocking it raises no warning at all.
  test('a first stocking of a new product shows no warning dialog', async ({ page }) => {
    const supplier = await createIsolatedSupplier('nowarning')
    const { productId } = await draftWithPricedLine(page, supplier, '25')
    await page.getByTestId('draft-commit').click()
    await expect(page).toHaveURL(/\/supplier\/stock$/)
    await expect(page.getByTestId('draft-warning-dialog')).toHaveCount(0)
    expect(await deliveriesOf(productId)).toEqual([
      { amount_supplied: 1, price: 25, voided_at: null },
    ])
  })
})
