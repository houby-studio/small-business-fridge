import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './helpers/auth'
import {
  createIsolatedSupplier,
  loginAsFreshSupplier,
  loginAsIsolated,
  queryDb,
} from './helpers/isolated_supplier'
import {
  commitDraft,
  createProduct,
  discardDraft,
  stockPreselected,
  stockProduct,
} from './helpers/products'

/** The badge on "Sklad" in the supplier menu: 1 while a draft with lines is open, else 0. */
async function stockBadgeCount(page: Page): Promise<number> {
  await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
  await page.locator('.sbf-nav').getByText('Dodavatel', { exact: true }).click()
  const badge = page.getByTestId('nav-stock-badge')
  const count = (await badge.count()) ? Number((await badge.textContent())!.trim()) : 0
  await page.keyboard.press('Escape')
  return count
}

test.describe('Stock receiving (příjemka)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
  })

  test('a new product is stocked in three interactions from the product form', async ({ page }) => {
    await loginAsFreshSupplier(page, 'stock-receiving')
    const name = `E2E Tři kroky ${Date.now()}`
    const productId = await createProduct(page, name)
    // Amount, Enter through the prices, Stock — the helper does exactly that.
    await stockPreselected(page, '4', '30')

    await page.goto(`/supplier/deliveries?productId=${productId}`)
    const row = page.locator('tbody tr').first()
    await expect(row).toContainText(name)
    await expect(row).toContainText('4 ks')
    await expect(row).toContainText('30 Kč')
  })

  test('a draft saves itself: a fresh edit survives leaving the page right away', async ({
    page,
  }) => {
    await loginAsFreshSupplier(page, 'stock-receiving')
    await page.goto('/supplier/stock')
    await page.getByTestId('stock-receive').click()
    await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+/)
    const draftUrl = page.url().split('?')[0]

    // Pick a product by typing, Enter lands in the amount.
    const filter = page.locator('.p-select-overlay .p-select-filter')
    await expect(filter).toBeFocused()
    await filter.fill('Kofola')
    await page.keyboard.press('Enter')
    await expect(page.locator(':focus')).toHaveAttribute('placeholder', 'ks')
    await page.locator(':focus').fill('7')
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('draft-save-state')).toHaveAttribute('data-state', 'saved')

    // A change made a moment before leaving is stored before the page goes away.
    const amount = page.getByTestId('draft-row-amount').first()
    await amount.fill('9')
    await page.keyboard.press('Tab')
    await page.getByRole('button', { name: 'Zpět' }).click()
    await expect(page).toHaveURL(/\/supplier\/stock(\?.*)?$/)

    await page.goto(draftUrl)
    await expect(page.getByTestId('draft-row-amount').first()).toHaveValue('9')
    await page.keyboard.press('Escape')
    await page.getByTestId('draft-discard').click()
    await page.locator('.p-confirmdialog').getByRole('button', { name: 'Zahodit' }).click()
    await expect(page).toHaveURL(/\/supplier\/stock(\?.*)?$/)
  })

  test('a product missing from the catalogue is created from the draft line and comes back to it', async ({
    page,
  }) => {
    await loginAsFreshSupplier(page, 'stock-receiving')
    const name = `E2E Nový z příjemky ${Date.now()}`
    await page.goto('/supplier/stock')
    await page.getByTestId('stock-receive').click()
    await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/(\d+)/)
    const draftUrl = page.url().split('?')[0]
    await page.keyboard.press('Escape')

    // "Nový produkt" on the empty line saves the draft and opens the product form.
    await page.getByTestId('draft-row-new-product').last().click()
    await expect(page).toHaveURL(/\/supplier\/products\/new\?.*draftId=\d+/)
    await page.locator('#product-name').fill(name)
    await page.locator('#product-description').fill('E2E z příjemky')
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Nealko' }).click()
    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-draft.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAGCAYAAADkOT91AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVR4nGM4IafxHxkz0EIAAMbhMTmfCC9yAAAAAElFTkSuQmCC',
        'base64'
      ),
    })
    await page.getByRole('button', { name: 'Vytvořit produkt' }).click()

    // Back on the very same draft, the new product sits in a line with the amount focused.
    await expect(page).toHaveURL(
      new RegExp(`^${draftUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?focus=\\d+$`)
    )
    const row = page.locator('[data-testid="draft-row"]', { hasText: name })
    await expect(row).toHaveCount(1)
    await expect(page.locator(':focus')).toHaveAttribute('placeholder', 'ks')
    await stockPreselected(page, '2', '25')
  })

  test('an existing product is stocked from the stock page by typing its name', async ({
    page,
  }) => {
    await loginAsFreshSupplier(page, 'stock-receiving')
    // An own product, created and then left alone for a moment: no seed data, and nothing
    // another test stocked lately can raise a duplicate warning.
    const name = `E2E Ze skladu ${Date.now()}`
    const productId = await createProduct(page, name)
    await discardDraft(page)
    await stockProduct(page, name, '2', '25')

    await page.goto(`/supplier/deliveries?productId=${productId}`)
    const row = page.locator('tbody tr')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(name)
    await expect(row).toContainText('2 ks')
    await expect(row).toContainText('25 Kč')
  })

  test('stocking the same product twice shows the warning and "Stock anyway" works', async ({
    page,
  }) => {
    await loginAsFreshSupplier(page, 'stock-receiving')
    const name = `E2E Dvakrát ${Date.now()}`
    const productId = await createProduct(page, name)
    await stockPreselected(page, '3', '40')

    await page.goto('/supplier/stock')
    await page.getByTestId('stock-receive').click()
    const filter = page.locator('.p-select-overlay .p-select-filter')
    await expect(filter).toBeFocused()
    await filter.fill(name)
    await page.keyboard.press('Enter')
    await page.locator(':focus').fill('3')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.getByTestId('draft-commit').click()

    const dialog = page.getByTestId('draft-warning-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('draft-warning-line')).toContainText(name)
    await expect(dialog.getByTestId('draft-warning-duplicate')).toContainText('3 ks po 40 Kč/ks')
    await dialog.getByTestId('draft-warning-confirm').click()
    await expect(page).toHaveURL(/\/supplier\/stock$/)
    await expect(page.getByText(/Naskladněno 3 ks/)).toBeVisible()

    await page.goto(`/supplier/deliveries?productId=${productId}`)
    await expect(page.locator('tbody tr')).toHaveCount(2)
  })

  test('the stock tabs lead to the history and the inventory', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/stock')
    await expect(page.getByRole('heading', { name: 'Sklad' })).toBeVisible()
    await expect(page.getByTestId('page-tabs').getByRole('link', { name: 'Stav' })).toHaveAttribute(
      'aria-current',
      'page'
    )

    // The scope the page shows (Stav defaults to "Celá lednice") travels with the tab.
    await page.getByTestId('page-tabs').getByRole('link', { name: 'Historie' }).click()
    await expect(page).toHaveURL(/\/supplier\/deliveries\?scope=all$/)
    await expect(page.getByTestId('deliveries-scope')).toContainText('Celá lednice')
    await expect(page.getByRole('heading', { name: 'Sklad' })).toBeVisible()
    await expect(
      page.getByTestId('page-tabs').getByRole('link', { name: 'Historie' })
    ).toHaveAttribute('aria-current', 'page')
    // A tab page keeps its menu entry lit — "Sklad", not "Naskladnění".
    await page.locator('.sbf-nav').getByText('Dodavatel', { exact: true }).click()
    await expect(page.locator('.sbf-nav-active', { hasText: 'Sklad' }).first()).toBeVisible()
    await expect(page.locator('.sbf-nav-active', { hasText: 'Naskladnění' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.getByTestId('page-tabs').getByRole('link', { name: 'Inventura' }).click()
    await expect(page).toHaveURL(/\/supplier\/inventory\?scope=all$/)

    // A scope picked on one tab travels to the next ("Celá lednice" is the default everywhere).
    await page.goto('/supplier/deliveries?scope=mine')
    await page.getByTestId('page-tabs').getByRole('link', { name: 'Stav' }).click()
    await expect(page).toHaveURL(/\/supplier\/stock\?scope=mine$/)
    await expect(page.getByTestId('stock-scope')).toContainText('Jen moje')
  })

  test('the history lists write-offs under their own type', async ({ page }) => {
    // A supplier of its own: the shared one's stock grows with every test, and "000" rows of
    // other tests would push this one off the first page.
    await loginAsIsolated(page, await createIsolatedSupplier('receiving'))
    // Leading zeros sort it onto the first page of the stock table.
    const name = `000 E2E Odpis ${Date.now()}`
    const productId = await createProduct(page, name)
    await stockPreselected(page, '5', '20')

    await page.goto('/supplier/stock?scope=mine')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    const row = page.locator('tr', { hasText: name })
    await expect(row).toContainText('5 ks')
    await row.getByTestId('stock-row-write-off').click()
    const dialog = page.getByTestId('write-off-dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('#write-off-quantity').fill('1')
    await dialog.getByTestId('write-off-confirm').click()
    await expect(page.getByText('Odepsáno 1 ks.')).toBeVisible()

    await page.goto('/supplier/deliveries')
    await expect(page.getByTestId('history-deliveries')).toBeVisible()
    await page.getByTestId('history-type').click()
    await page.getByRole('option', { name: 'Odpisy a inventury' }).click()
    await expect(page).toHaveURL(/type=adjustments/)
    const adjustments = page.getByTestId('history-adjustments')
    await expect(adjustments).toBeVisible()
    const writeOff = adjustments.locator('tbody tr', { hasText: name }).first()
    await expect(writeOff.getByTestId('adjustment-quantity')).toHaveText('−1 ks')
    await expect(writeOff).toContainText('Prošlé')

    await page.goto(`/supplier/deliveries?type=adjustments&productId=${productId}`)
    await expect(page.getByTestId('history-adjustments').locator('tbody tr')).toHaveCount(1)
  })

  test('one open draft: the stock page chip and the menu badge lead to it until it is stocked', async ({
    page,
  }) => {
    const supplier = await createIsolatedSupplier('one-draft')
    await loginAsIsolated(page, supplier)
    await page.goto('/supplier/stock')
    await expect(page.getByTestId('stock-draft-open')).toHaveCount(0)
    expect(await stockBadgeCount(page)).toBe(0)

    const name = `E2E Jedna příjemka ${Date.now()}`
    await createProduct(page, name)
    const draftUrl = page.url().split('?')[0]
    // The old list page only leads to the draft now.
    await page.goto('/supplier/stock/drafts')
    await expect(page).toHaveURL(draftUrl)

    await page.goto('/supplier/stock')
    const chip = page.getByTestId('stock-draft-open')
    await expect(chip).toHaveText('Rozpracovaná příjemka · 1 položka')
    expect(await stockBadgeCount(page)).toBe(1)

    // "Naskladnit" continues the same draft — there is never a second one.
    await page.getByTestId('stock-receive').click()
    await expect(page).toHaveURL(draftUrl)
    await page.keyboard.press('Escape')
    const price = page
      .locator('[data-testid="draft-row"]', { hasText: name })
      .getByTestId('draft-row-price')
    await price.fill('30')
    await price.press('Enter')
    await commitDraft(page)

    await expect(page.getByTestId('stock-draft-open')).toHaveCount(0)
    expect(await stockBadgeCount(page)).toBe(0)
    await page.goto('/supplier/stock/drafts')
    await expect(page).toHaveURL(/\/supplier\/stock$/)
  })

  test('a failed save holds the page: no "Saved", and leaving asks first', async ({ page }) => {
    await loginAsFreshSupplier(page, 'stock-receiving')
    const name = `E2E Výpadek ${Date.now()}`
    await createProduct(page, name)
    const save = page.getByTestId('draft-save-state')
    await expect(save).toHaveAttribute('data-state', 'saved')

    // The network is gone: the autosave fails and says so instead of "Uloženo".
    await page.route(/\/supplier\/stock\/drafts\/\d+$/, (route) =>
      route.request().method() === 'PUT' ? route.abort() : route.continue()
    )
    const row = page.locator('[data-testid="draft-row"]', { hasText: name })
    await row.getByTestId('draft-row-amount').fill('8')
    await page.keyboard.press('Tab')
    await expect(save).toHaveAttribute('data-state', 'error')

    // Leaving tries once more, fails, and asks before the change is left behind.
    await page.getByTestId('draft-back').click()
    const confirm = page.locator('.p-confirmdialog')
    await expect(confirm).toContainText('Poslední změny se nepodařilo uložit')
    await confirm.getByRole('button', { name: 'Zrušit' }).click()
    await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+/)
    await expect(row.getByTestId('draft-row-amount')).toHaveValue('8')

    // Back online, the next save goes through and the draft can be left normally.
    await page.unroute(/\/supplier\/stock\/drafts\/\d+$/)
    await row.getByTestId('draft-row-amount').fill('9')
    await page.keyboard.press('Tab')
    await expect(save).toHaveAttribute('data-state', 'saved')
    await discardDraft(page)
  })

  test('an expired session or a refused line never replaces the draft with an error page', async ({
    page,
  }) => {
    await loginAsFreshSupplier(page, 'stock-receiving')
    const name = `E2E Odmítnuto ${Date.now()}`
    await createProduct(page, name)
    const save = page.getByTestId('draft-save-state')
    const row = page.locator('[data-testid="draft-row"]', { hasText: name })
    await expect(save).toHaveAttribute('data-state', 'saved')

    for (const [status, amount] of [
      [419, '4'],
      [422, '5'],
      [500, '6'],
    ] as const) {
      await page.route(/\/supplier\/stock\/drafts\/\d+$/, (route) =>
        route.request().method() === 'PUT'
          ? route.fulfill({ status, contentType: 'text/html', body: '<h1>error</h1>' })
          : route.continue()
      )
      await row.getByTestId('draft-row-amount').fill(amount)
      await page.keyboard.press('Tab')
      await expect(save).toHaveAttribute('data-state', 'error')
      // No Inertia error modal, the lines are still there to be saved later.
      await expect(page.locator('iframe')).toHaveCount(0)
      await expect(row.getByTestId('draft-row-amount')).toHaveValue(amount)
      await page.unroute(/\/supplier\/stock\/drafts\/\d+$/)
    }

    await row.getByTestId('draft-row-amount').fill('3')
    await page.keyboard.press('Tab')
    await expect(save).toHaveAttribute('data-state', 'saved')
    await discardDraft(page)
  })

  test('a change made just before the browser Back button is not lost', async ({ page }) => {
    await loginAsFreshSupplier(page, 'stock-receiving')
    const name = `E2E Zpět prohlížeče ${Date.now()}`
    await createProduct(page, name)
    const draftUrl = page.url().split('?')[0]
    const row = page.locator('[data-testid="draft-row"]', { hasText: name })
    await expect(page.getByTestId('draft-save-state')).toHaveAttribute('data-state', 'saved')

    await row.getByTestId('draft-row-amount').fill('11')
    await page.keyboard.press('Tab')
    // Straight away, before the autosave pause is over: the page sends it as it goes.
    const sent = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        /\/supplier\/stock\/drafts\/\d+$/.test(response.url())
    )
    await page.goBack()
    const response = await sent
    expect(response.status()).toBe(200)
    await expect(page).not.toHaveURL(new RegExp(`${draftUrl}($|\\?)`))

    await page.goto(draftUrl)
    await expect(
      page.locator('[data-testid="draft-row"]', { hasText: name }).getByTestId('draft-row-amount')
    ).toHaveValue('11')
    await page.keyboard.press('Escape')
    await discardDraft(page)
  })

  test('a draft changed in another tab is reloaded instead of overwritten', async ({
    page,
    context,
  }) => {
    await loginAsFreshSupplier(page, 'stock-receiving')
    const name = `E2E Dvě záložky ${Date.now()}`
    await createProduct(page, name)
    const draftUrl = page.url().split('?')[0]
    const row = page.locator('[data-testid="draft-row"]', { hasText: name })
    await expect(page.getByTestId('draft-save-state')).toHaveAttribute('data-state', 'saved')

    // A second tab (or the AI assistant) changes the draft.
    const other = await context.newPage()
    await other.goto(draftUrl)
    const otherRow = other.locator('[data-testid="draft-row"]', { hasText: name })
    await other.keyboard.press('Escape')
    await otherRow.getByTestId('draft-row-amount').fill('24')
    await other.keyboard.press('Tab')
    await expect(other.getByTestId('draft-save-state')).toHaveAttribute('data-state', 'saved')
    await other.close()

    // The first tab's next save is refused; it shows the newer draft and says why.
    await row.getByTestId('draft-row-amount').fill('2')
    await page.keyboard.press('Tab')
    await expect(page.getByText('Příjemka se mezitím změnila')).toBeVisible()
    await expect(row.getByTestId('draft-row-amount')).toHaveValue('24')
    await expect(page.getByTestId('draft-save-state')).toHaveAttribute('data-state', 'saved')
    await discardDraft(page)
  })

  test('"Stock" twice on one product keeps one line; a removed line can be put back', async ({
    page,
  }) => {
    // A supplier of its own: the shared one's stock grows with every test, and "000" rows of
    // other tests would push this one off the first page.
    await loginAsIsolated(page, await createIsolatedSupplier('receiving'))
    // Leading zeros sort it onto the first page of the stock table.
    const name = `000 E2E Jednou ${Date.now()}`
    await createProduct(page, name)
    await stockPreselected(page, '2', '20')

    await page.goto('/supplier/stock?scope=mine')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    const stockRow = page.locator('tr', { hasText: name })
    await stockRow.getByTestId('stock-row-receive').dblclick()
    await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+\?focus=\d+/)
    const lines = page.locator('[data-testid="draft-row"]', { hasText: name })
    await expect(lines).toHaveCount(1)

    await page.goto('/supplier/stock?scope=mine')
    await page.locator('tr', { hasText: name }).getByTestId('stock-row-receive').click()
    await expect(page).toHaveURL(/\?focus=\d+/)
    await expect(lines).toHaveCount(1)
    // The existing line is focused, ready for a new count.
    await expect(page.locator(':focus')).toHaveAttribute('placeholder', 'ks')

    // Picking the same product on another line is allowed, but pointed out.
    await page.keyboard.press('Escape')
    const ghost = page.getByTestId('draft-row').last()
    await ghost.getByTestId('draft-row-product').click()
    await page.locator('.p-select-overlay .p-select-filter').fill(name)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('draft-row-duplicate')).toContainText('i na řádku')

    // Removing a line offers to undo it.
    const before = await page.getByTestId('draft-row').count()
    await page.getByTestId('draft-row-remove').last().click()
    await expect(page.getByTestId('draft-row')).toHaveCount(before - 1)
    await page.getByTestId('draft-row-undo').click()
    await expect(page.getByTestId('draft-row')).toHaveCount(before)
    await discardDraft(page)
  })

  test('the stock-state choices count exactly what they list', async ({ page }) => {
    // Own stock with known levels, so other tests stocking in parallel change nothing here.
    const supplier = await loginAsFreshSupplier(page, 'stock-state')
    const stamp = Date.now()
    const low = `E2E Stav málo ${stamp}`
    const plenty = `E2E Stav dost ${stamp}`
    const gone = `E2E Stav pryč ${stamp}`
    for (const [name, amount] of [
      [low, '2'],
      [plenty, '6'],
      [gone, '3'],
    ] as const) {
      await createProduct(page, name)
      await stockPreselected(page, amount, '20')
    }
    // The last product sold out (as a write-off would leave it).
    await queryDb(
      `UPDATE deliveries d SET amount_lost = d.amount_supplied, amount_left = 0
         FROM products p
        WHERE p.id = d.product_id AND p.display_name = $1 AND d.supplier_id = $2`,
      [gone, supplier.id]
    )

    await page.goto('/supplier/stock?scope=mine')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    for (const [label, state, name] of [
      ['Nízký stav (1)', 'low', low],
      ['Vyprodáno (1)', 'out', gone],
    ] as const) {
      await page.getByTestId('stock-state').click()
      await page.getByRole('option', { name: label, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`stockState=${state}`))
      const rows = page.locator('tbody tr[data-p-index]')
      await expect(rows).toHaveCount(1)
      await expect(rows.first()).toContainText(name)
    }
  })

  test('the price of the pieces left changes from the stock page', async ({ page }) => {
    // A supplier of its own: the shared one's stock grows with every test, and "000" rows of
    // other tests would push this one off the first page.
    await loginAsIsolated(page, await createIsolatedSupplier('receiving'))
    const name = `000 E2E Sleva ${Date.now()}`
    await createProduct(page, name)
    await stockPreselected(page, '5', '20')

    await page.goto('/supplier/stock?scope=mine')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    const row = page.locator('tr', { hasText: name })
    await row.getByTestId('stock-row-reprice').click()
    const dialog = page.getByTestId('reprice-dialog')
    await expect(dialog).toContainText(`Změnit cenu · ${name}`)
    await expect(dialog.getByTestId('reprice-lot')).toHaveCount(1)
    await expect(dialog.getByTestId('reprice-lot')).toContainText('5 ks')
    // "Nastavit všem mým" opens focused on the current price; Enter fills my lots.
    const all = dialog.locator('#reprice-all')
    await expect(all).toBeFocused()
    await expect(all).toHaveValue('20 Kč')
    await expect(dialog.getByTestId('reprice-confirm')).toBeDisabled()
    await page.keyboard.type('16')
    await page.keyboard.press('Enter')
    await expect(dialog.getByTestId('reprice-lot-price').locator('input')).toHaveValue('16 Kč')
    await expect(dialog.getByTestId('reprice-summary')).toHaveText(
      'Změní se 1 dodávka · 5 ks na skladě'
    )
    await dialog.getByTestId('reprice-confirm').click()
    await expect(
      page.getByText('Cena změněna u 1 dodávky (5 ks na skladě). Prodané kusy se nemění.')
    ).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(row).toContainText('80 Kč')
  })

  test('a stocked draft is found in the history under "Příjemky" and voided as a whole', async ({
    page,
  }) => {
    await loginAsFreshSupplier(page, 'stock-receiving')
    const name = `E2E Storno příjemky ${Date.now()}`
    const productId = await createProduct(page, name)
    await stockPreselected(page, '3', '25')

    await page.goto('/supplier/deliveries?type=drafts&scope=mine')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    const drafts = page.getByTestId('history-drafts')
    // Newest number first: the draft just stocked.
    const newest = drafts.locator('tbody tr').first()
    await expect(newest).toContainText('3')
    await newest.getByTestId('history-draft-link').click()
    await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+$/)
    const draftUrl = page.url()
    await expect(page.locator('[data-testid="draft-row"]', { hasText: name })).toHaveCount(1)
    await expect(page.getByTestId('draft-commit')).toHaveCount(0)

    await page.getByTestId('draft-void').click()
    const dialog = page.getByTestId('draft-void-dialog')
    await expect(dialog.getByTestId('draft-void-reason')).toBeFocused()
    await expect(dialog.getByTestId('draft-void-confirm')).toBeDisabled()
    await page.keyboard.type('Účtenka zadaná dvakrát')
    await dialog.getByTestId('draft-void-confirm').click()
    await expect(page.getByText(/Příjemka stornována/)).toBeVisible()
    await expect(page.getByTestId('draft-closed')).toContainText('Účtenka zadaná dvakrát')
    await expect(page.getByTestId('draft-void')).toHaveCount(0)

    // The lot is gone from the stock: the history shows it voided and leads back to its draft.
    await page.goto(`/supplier/deliveries?productId=${productId}`)
    const lot = page.locator('tbody tr').first()
    await expect(lot).toContainText('Stornováno')
    const link = lot.getByTestId('delivery-draft-link')
    await expect(link).toHaveText(`Příjemka #${draftUrl.match(/(\d+)$/)![1]}`)
    await link.click()
    await expect(page).toHaveURL(draftUrl)
    await expect(page.getByTestId('draft-closed')).toContainText('Účtenka zadaná dvakrát')
  })

  test('on a phone the row actions and the Stock button stay on screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 740 })
    await loginAsFreshSupplier(page, 'stock-receiving')
    await page.goto('/supplier/stock')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    // Below `md` the row actions share one menu button, fully on the screen.
    const actions = page.getByTestId('stock-row-actions').first()
    await expect(actions).toBeInViewport({ ratio: 1 })
    await expect(page.getByTestId('stock-row-receive').first()).toBeHidden()

    await actions.click()
    await page.getByTestId('stock-menu-receive').click()
    await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+/)
    // The footer sticks to the bottom however long the draft is.
    await expect(page.getByTestId('draft-footer')).toHaveCSS('position', 'sticky')
    await expect(page.getByTestId('draft-commit')).toBeInViewport()
    await page.keyboard.press('Escape')
    await discardDraft(page)
  })
})
