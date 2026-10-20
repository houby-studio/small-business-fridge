import { expect, type Page } from '@playwright/test'

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAGCAYAAADkOT91AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVR4nGM4IafxHxkz0EIAAMbhMTmfCC9yAAAAAElFTkSuQmCC',
  'base64'
)

/**
 * Creates an own product through the form, so a test never depends on (or changes) the
 * seeded catalogue. The form lands on a stocking draft (příjemka) with a line for the new
 * product and the amount field focused; returns the product id.
 */
export async function createProduct(page: Page, name: string): Promise<number> {
  await page.goto('/supplier/products/new')
  await page.locator('#product-name').fill(name)
  await page.locator('#product-description').fill('E2E nákupní seznam')
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Nealko' }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'e2e-shopping.png',
    mimeType: 'image/png',
    buffer: PIXEL_PNG,
  })
  await page.getByRole('button', { name: 'Vytvořit produkt' }).click()
  await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+\?focus=\d+/)
  // The new line is appended, so it is the last one with a product (a draft left open by an
  // earlier test may hold lines before it).
  const row = page.locator('[data-testid="draft-row"][data-product-id]:not([data-product-id=""])')
  await expect(row.last()).toBeVisible()
  return Number(await row.last().getAttribute('data-product-id'))
}

export interface CommitOptions {
  /**
   * The commit is expected to stop on the warning dialog (the same product stocked again
   * within the duplicate window, an unusual price…), which is then confirmed. Without it a
   * warning is a failure: a regression that flags every line must not hide behind a helper
   * that clicks "Přesto naskladnit" for every test.
   */
  expectWarning?: boolean
}

/**
 * Finishes stocking on a draft whose amount field is focused (where the product form lands):
 * fills the line with the keyboard, confirms it, stocks the draft and waits for the result.
 */
export async function stockPreselected(
  page: Page,
  amount: string,
  price: string,
  purchasePrice?: string,
  options: CommitOptions = {}
) {
  const focused = page.locator(':focus')
  await expect(focused).toHaveAttribute('placeholder', 'ks')
  await focused.fill(amount)
  await page.keyboard.press('Enter')
  if (purchasePrice !== undefined) {
    await page.locator(':focus').fill(purchasePrice)
  }
  await page.keyboard.press('Enter')
  await page.locator(':focus').fill(price)
  await page.keyboard.press('Enter')
  await commitDraft(page, options)
}

/**
 * Stocks an existing product from the stock page: "Naskladnit" opens the supplier's draft,
 * the product is picked by name in the empty line, the rest goes like `stockPreselected`.
 */
export async function stockProduct(
  page: Page,
  productName: string,
  amount: string,
  price: string,
  purchasePrice?: string,
  options: CommitOptions = {}
) {
  await page.goto('/supplier/stock')
  await page.getByTestId('stock-receive').click()
  await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+/)
  const filter = page.locator('.p-select-overlay .p-select-filter')
  await expect(filter).toBeFocused()
  await filter.fill(productName)
  await page.keyboard.press('Enter')
  await stockPreselected(page, amount, price, purchasePrice, options)
}

const STOCKED_URL = /\/supplier\/stock(\?.*)?$/

/**
 * Presses "Naskladnit" and waits for the stock page with its toast. A warning dialog is
 * confirmed only when the caller says one is expected; an unexpected one fails the test with
 * the warning's text, and a missing expected one fails it too.
 */
export async function commitDraft(page: Page, { expectWarning = false }: CommitOptions = {}) {
  await page.getByTestId('draft-commit').click()
  const warning = page.getByTestId('draft-warning-dialog')
  // Whichever comes first decides; neither wait swallows its own timeout.
  const outcome = await Promise.race([
    warning.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'warning' as const),
    page.waitForURL(STOCKED_URL, { timeout: 15_000 }).then(() => 'stocked' as const),
  ])
  if (outcome === 'warning') {
    if (!expectWarning) {
      const text = await warning.innerText()
      throw new Error(`Stocking stopped on an unexpected warning: ${text.replace(/\s+/g, ' ')}`)
    }
    await warning.getByTestId('draft-warning-confirm').click()
    await page.waitForURL(STOCKED_URL)
  } else if (expectWarning) {
    throw new Error('Stocking went through, but a warning dialog was expected first.')
  }
  // The toast itself — the stock table has a "Naskladněno" column header too.
  await expect(page.getByText(/^Naskladněno \d+ ks \(\d+ dodáv/).first()).toBeVisible()
}

/** Throws the open draft away (its lines included), so the next test starts from a clean one. */
export async function discardDraft(page: Page) {
  await page.getByTestId('draft-discard').click()
  await page.locator('.p-confirmdialog').getByRole('button', { name: 'Zahodit' }).click()
  await expect(page).toHaveURL(/\/supplier\/stock(\?.*)?$/)
}
