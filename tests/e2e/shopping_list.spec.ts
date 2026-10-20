import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './helpers/auth'
import { createIsolatedSupplier, loginAsIsolated } from './helpers/isolated_supplier'
import { createProduct, discardDraft } from './helpers/products'

async function openShoppingList(page: Page) {
  await page.goto('/supplier/shopping-list')
  await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Nákupní seznam' })).toBeVisible()
}

async function addOwnLine(page: Page, label: string, quantity: string) {
  await page.getByTestId('shopping-add-line').click()
  const dialog = page.getByTestId('shopping-add-dialog')
  await expect(dialog).toBeVisible()
  // The dialog opens in the product search; the custom item is one click away.
  await expect(page.locator('.p-select-overlay .p-select-filter')).toBeFocused()
  await page.keyboard.press('Escape')
  await dialog.getByTestId('shopping-add-mode').getByText('Vlastní položka').click()
  await expect(dialog.locator('#shopping-add-label')).toBeFocused()
  await page.keyboard.type(label)
  // Enter moves on: name → quantity → note → add.
  await page.keyboard.press('Enter')
  await expect(dialog.locator('#shopping-add-quantity')).toBeFocused()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(quantity)
  await page.keyboard.press('Enter')
  await expect(dialog.locator('#shopping-add-note')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
}

test.describe('Supplier shopping list', () => {
  test('is reachable from the supplier menu', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
    await loginAs(page, 'supplier')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await page.locator('.sbf-nav').getByText('Dodavatel', { exact: true }).click()
    await page.getByRole('menuitem', { name: 'Nákupní seznam' }).click()
    await expect(page).toHaveURL(/\/supplier\/shopping-list$/)

    // The list explains itself: no paragraph under the heading, no banner about drafts
    // (the nav badge and the stock page's chip cover those).
    await expect(page.getByRole('heading', { name: 'Nákupní seznam' })).toBeVisible()
    await expect(page.getByText('Návrh, co koupit')).toHaveCount(0)
    await expect(page.getByTestId('shopping-open-drafts')).toHaveCount(0)
    await expect(page.getByTestId('shopping-horizon-usual')).toContainText(
      /^Obvykle \d+ (den|dny|dní)/
    )
  })

  test('own items can be added, changed, ticked and removed', async ({ page }) => {
    await loginAsIsolated(page, await createIsolatedSupplier('list'))
    await openShoppingList(page)

    const label = `E2E položka ${Date.now()}`
    await addOwnLine(page, label, '4')
    const line = page.locator('[data-testid^="shopping-line-c-"]', { hasText: label })
    await expect(line).toBeVisible()

    const quantity = line.locator('input[id^="shopping-qty-"]')
    await expect(quantity).toHaveValue('4 ks')
    const saved = page.waitForResponse(
      (r) => r.url().includes('/supplier/shopping-list') && r.request().method() === 'GET'
    )
    // InputNumber commits a typed value on Enter (or blur).
    await quantity.fill('7')
    await quantity.press('Enter')
    await saved
    await page.reload()
    await expect(
      page
        .locator('[data-testid^="shopping-line-c-"]', { hasText: label })
        .locator('input[id^="shopping-qty-"]')
    ).toHaveValue('7 ks')

    const reloaded = page.locator('[data-testid^="shopping-line-c-"]', { hasText: label })
    await reloaded.locator('input[type="checkbox"]').click()
    await expect(reloaded).toHaveClass(/opacity-70/)

    await reloaded.getByRole('button', { name: `Odebrat ${label}` }).click()
    await expect(page.locator('[data-testid^="shopping-line-c-"]', { hasText: label })).toHaveCount(
      0
    )
  })

  test('the add dialog works from the keyboard alone (P4)', async ({ page }) => {
    await loginAsIsolated(page, await createIsolatedSupplier('list'))
    await openShoppingList(page)

    await page.getByTestId('shopping-add-line').click()
    const dialog = page.getByTestId('shopping-add-dialog')
    // The product search is open and has the focus; the first match is highlighted.
    const filter = page.locator('.p-select-overlay .p-select-filter')
    await expect(filter).toBeFocused()
    await page.keyboard.type('0.5L')
    await expect(page.locator('.p-select-overlay .p-select-option.p-focus')).toHaveText(
      'Coca-Cola 0.5L'
    )
    // ArrowDown goes to the second match, Enter takes it and moves on to the quantity.
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.p-select-overlay .p-select-option.p-focus')).toHaveText(
      'Fanta 0.5L'
    )
    await page.keyboard.press('Enter')
    await expect(dialog.locator('#shopping-add-quantity')).toBeFocused()
    await page.keyboard.type('3')
    await page.keyboard.press('Enter')
    await expect(dialog.locator('#shopping-add-note')).toBeFocused()
    await page.keyboard.type('klávesnicí')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()

    const line = page.locator('[data-testid^="shopping-line-p-"]', { hasText: 'Fanta 0.5L' })
    await expect(line).toContainText('klávesnicí')
    await expect(line.locator('input[id^="shopping-qty-"]')).toHaveValue('3 ks')
    // Leave the shared list as it was.
    await line.getByRole('button', { name: 'Odebrat Fanta 0.5L' }).click()
    await expect(line).toHaveCount(0)
  })

  test('the last action on a line wins, however slow the network (P5)', async ({ page }) => {
    await loginAsIsolated(page, await createIsolatedSupplier('list'))
    await openShoppingList(page)
    const label = `E2E poslední akce ${Date.now()}`
    await addOwnLine(page, label, '4')
    const line = page.locator('[data-testid^="shopping-line-c-"]', { hasText: label })
    const quantity = line.locator('input[id^="shopping-qty-"]')
    await expect(quantity).toHaveValue('4 ks')

    // Every line edit now takes a second and a half to reach the server.
    await page.route('**/supplier/shopping-list/lines/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.continue()
    })

    // 7 is on its way when the supplier changes their mind to 9.
    await quantity.fill('7')
    await quantity.press('Enter')
    await page.waitForTimeout(700)
    await quantity.fill('9')
    await quantity.press('Enter')
    await expect(quantity).toHaveValue('9 ks')
    // A tick and an untick in quick succession end unticked.
    const checkbox = line.locator('input[type="checkbox"]')
    await checkbox.click()
    await checkbox.click()

    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(4000)
    await expect(quantity).toHaveValue('9 ks')
    await expect(line).not.toHaveClass(/opacity-70/)
    await page.unroute('**/supplier/shopping-list/lines/**')
    await page.reload()
    const reloaded = page.locator('[data-testid^="shopping-line-c-"]', { hasText: label })
    await expect(reloaded.locator('input[id^="shopping-qty-"]')).toHaveValue('9 ks')
    await expect(reloaded).not.toHaveClass(/opacity-70/)
    await reloaded.getByRole('button', { name: `Odebrat ${label}` }).click()
    await expect(reloaded).toHaveCount(0)
  })

  test('"back to the suggestion" right after a change wins, and the other way round (P5)', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await loginAsIsolated(page, await createIsolatedSupplier('list'))
    // A purchase group is planned as a suggestion — a line that can go back to it.
    const groupName = `E2E Návrh ${Date.now()}`
    await page.goto('/supplier/product-groups')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await page.getByTestId('group-create').click()
    const groupDialog = page.getByTestId('group-dialog')
    await expect(groupDialog.locator('#group-name')).toBeFocused()
    await page.keyboard.type(groupName)
    await groupDialog.getByTestId('group-category').click()
    await page.getByRole('option', { name: 'Nealko' }).click()
    await groupDialog.getByTestId('group-products').click()
    await page.locator('.p-multiselect-overlay .p-multiselect-filter').fill('Mattoni')
    await page.getByRole('option', { name: 'Mattoni 0.5L' }).click()
    await page.keyboard.press('Escape')
    await groupDialog.getByTestId('group-save').click()
    await expect(page.getByRole('cell', { name: groupName })).toBeVisible()

    await openShoppingList(page)
    const scope = page.getByTestId('shopping-scope')
    const scopeBefore = (await scope.textContent())!.trim()
    if (scopeBefore !== 'Celá lednice') {
      await scope.click()
      await page.getByRole('option', { name: 'Celá lednice' }).click()
    }
    const line = page.locator('[data-testid^="shopping-line-g-"]', { hasText: groupName })
    const quantity = line.locator('input[id^="shopping-qty-"]')
    const reset = line.locator('[data-testid^="shopping-reset-"]')

    /** Puts the line on the list with an own quantity (a suggestion of 0 waits under "covered"). */
    async function override(value: string) {
      if ((await line.count()) === 0) {
        if (!(await page.getByTestId('shopping-covered').isVisible())) {
          await page.getByTestId('shopping-covered-toggle').click()
        }
        await page.getByRole('button', { name: `Přidat ${groupName} na seznam` }).click()
        await expect(line).toBeVisible()
      }
      await quantity.fill(value)
      await quantity.press('Enter')
      await expect(reset).toBeVisible()
    }
    // What the suggestion is: reset once on a normal network.
    await override('5')
    await reset.click()
    await expect(reset).toHaveCount(0)
    await page.waitForLoadState('networkidle')
    const onList = (await line.count()) > 0
    const suggested = onList ? await quantity.inputValue() : null

    await override('5')
    await page.route('**/supplier/shopping-list/lines/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.continue()
    })

    // A change on its way — then straight back to the suggestion.
    await quantity.fill('77')
    await quantity.press('Enter')
    await page.waitForTimeout(700)
    await reset.click()
    await page.waitForTimeout(6000)
    if (suggested === null) await expect(line).toHaveCount(0)
    else {
      await expect(quantity).toHaveValue(suggested)
      await expect(reset).toHaveCount(0)
    }

    // The other way round: back to the suggestion is on its way when a new number comes.
    await page.unroute('**/supplier/shopping-list/lines/**')
    await override('5')
    await page.route('**/supplier/shopping-list/lines/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.continue()
    })
    await reset.click()
    await quantity.fill('66')
    await quantity.press('Enter')
    await page.waitForTimeout(6000)
    await expect(quantity).toHaveValue('66 ks')

    await page.unroute('**/supplier/shopping-list/lines/**')
    await page.reload()
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await expect(quantity).toHaveValue('66 ks')

    // Leave the shared settings and catalogue as they were.
    await reset.click()
    await expect(reset).toHaveCount(0)
    if (scopeBefore !== 'Celá lednice') {
      await page.getByTestId('shopping-scope').click()
      await page.getByRole('option', { name: scopeBefore }).click()
    }
    await page.goto('/supplier/product-groups')
    const row = page.locator('tr', { hasText: groupName })
    await row.getByRole('button', { name: 'Smazat' }).click()
    await page.locator('.p-confirmdialog').getByRole('button', { name: 'Smazat' }).click()
    await expect(page.getByRole('cell', { name: groupName })).toHaveCount(0)
  })

  test('the horizon slider plans for another trip length and goes back to the habit', async ({
    page,
  }) => {
    await loginAsIsolated(page, await createIsolatedSupplier('list'))
    await openShoppingList(page)

    const label = page.getByTestId('shopping-horizon-label')
    const before = (await label.textContent())!.trim()
    const slider = page.getByRole('slider', { name: 'Na kolik dní nakupujete' })
    await slider.focus()
    await slider.press('ArrowRight')
    await slider.press('ArrowRight')
    await expect(label).not.toHaveText(before)

    // Saved once the slider rests: the plan is no longer the automatic one.
    const reset = page.getByTestId('shopping-horizon-reset')
    await expect(reset).toBeVisible()
    await expect(reset).toHaveText('Vrátit')
    const chosen = (await label.textContent())!.trim()
    await page.reload()
    await expect(page.getByTestId('shopping-horizon-label')).toHaveText(chosen)

    await page.getByTestId('shopping-horizon-reset').click()
    await expect(page.getByTestId('shopping-horizon-reset')).toHaveCount(0)
    await expect(page.getByTestId('shopping-horizon-label')).toHaveText(before)
  })

  test('finishing the list prepares a draft that stocks everything at once', async ({ page }) => {
    await loginAsIsolated(page, await createIsolatedSupplier('list'))
    const name = `E2E Seznam ${Date.now()}`
    const productId = await createProduct(page, name)
    // The product is stocked through the list below, not through the manual draft.
    await discardDraft(page)
    await openShoppingList(page)

    await page.getByTestId('shopping-add-line').click()
    const dialog = page.getByTestId('shopping-add-dialog')
    // The product search opens with the dialog.
    await expect(page.locator('.p-select-overlay .p-select-filter')).toBeFocused()
    await page.locator('.p-select-overlay .p-select-filter').fill(name)
    await page.getByRole('option', { name }).click()
    await dialog.locator('#shopping-add-quantity').fill('6')
    await dialog.locator('#shopping-add-cost').fill('12,9')
    await dialog.getByTestId('shopping-add-submit').click()
    await expect(dialog).toBeHidden()

    const line = page.getByTestId(`shopping-line-p-${productId}`)
    await expect(line).toBeVisible()
    // Price and stock share one line of metadata; the category is a dot, not a tag (UX-16).
    await expect(page.getByTestId(`shopping-meta-p-${productId}`)).toContainText('12,90 Kč')
    await expect(page.getByTestId(`shopping-meta-p-${productId}`)).toContainText('skladem')
    await expect(line.locator('.p-tag')).toHaveCount(0)
    // Only ticked lines go to the draft when anything is ticked.
    await line.locator('input[type="checkbox"]').click()
    await expect(line).toHaveClass(/opacity-70/)

    await page.getByTestId('shopping-complete').click()
    await page
      .locator('.p-confirmdialog')
      .getByRole('button', { name: 'Vytvořit příjemku' })
      .click()
    await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+$/)

    // The list's lines join the one open draft — the product's line is there once.
    const lines = page.locator(`[data-testid="draft-row"][data-product-id="${productId}"]`)
    await expect(lines).toHaveCount(1)
    await expect(lines.first()).toContainText(name)
    await expect(lines.first().getByTestId('draft-row-price')).toHaveAttribute(
      'placeholder',
      'návrh 13 Kč'
    )

    // The list's purchase price is only an estimate until the receipt says otherwise.
    await expect(lines.first().getByTestId('draft-row-estimated')).toBeVisible()

    // The button says what it does; the one question left is about that estimate.
    const commit = page.getByTestId('draft-commit')
    await expect(commit).toHaveText(/Naskladnit \(1 položka · 6 ks\)/)
    await commit.click()
    const warning = page.getByTestId('draft-warning-dialog')
    await expect(warning.getByTestId('draft-warning-estimated')).toContainText(
      '1 řádek má nákupní cenu jen odhadnutou ze seznamu'
    )
    await warning.getByTestId('draft-warning-confirm').click()
    await expect(page).toHaveURL(/\/supplier\/stock$/)
    await expect(page.getByText('Naskladněno 6 ks (1 dodávka).')).toBeVisible()

    await page.goto(`/supplier/deliveries?productId=${productId}`)
    const delivery = page.locator('tbody tr').first()
    await expect(delivery).toContainText('13 Kč')
    await expect(delivery).toContainText('nákup 12,90 Kč')
  })

  test('a draft cannot be stocked until every line has a price, and can be discarded', async ({
    page,
  }) => {
    await loginAsIsolated(page, await createIsolatedSupplier('list'))
    const name = `E2E Návrh ${Date.now()}`
    const productId = await createProduct(page, name)
    const line = page.locator(`[data-testid="draft-row"][data-product-id="${productId}"]`)

    // The new product has no price yet; the empty trailing line is not a problem.
    await expect(line.getByTestId('draft-row-problem')).toHaveText(
      'Zadejte prodejní nebo nákupní cenu.'
    )
    await expect(page.getByText('Vyberte produkt.')).toHaveCount(0)
    await expect(page.getByTestId('draft-commit')).toBeDisabled()

    const price = line.getByTestId('draft-row-price')
    await price.fill('25')
    await price.press('Enter')
    await expect(page.getByTestId('draft-commit')).toBeEnabled()
    await page.keyboard.press('Escape')

    await page.getByTestId('draft-discard').click()
    await page.locator('.p-confirmdialog').getByRole('button', { name: 'Zahodit' }).click()
    // There is no list of drafts any more — a discarded draft leads back to the stock.
    await expect(page).toHaveURL(/\/supplier\/stock(\?.*)?$/)
    await expect(page.getByText('Příjemka byla zahozena.')).toBeVisible()
  })
})

test.describe('Supplier purchase groups', () => {
  test('a group is created, filled from the product form and deleted', async ({ page }) => {
    await loginAsIsolated(page, await createIsolatedSupplier('list'))
    const productName = `E2E Člen ${Date.now()}`
    const productId = await createProduct(page, productName)
    // Not stocking here — leave no half-filled line behind for the next test.
    await discardDraft(page)
    const groupName = `E2E Skupina ${Date.now()}`

    await page.goto('/supplier/product-groups')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    // Groups are a tab of the products page; the explanation sits behind the (i).
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Produkty')
    await expect(page.getByTestId('tab-product-groups')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByText('Skupina spojí zaměnitelné produkty —')).toHaveCount(0)
    await page.getByTestId('groups-hint').click()
    await expect(page.getByRole('dialog')).toContainText('zaměnitelné produkty')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByTestId('group-create').click()
    const dialog = page.getByTestId('group-dialog')
    // The name has the focus and Enter saves (UX-09).
    await expect(dialog.locator('#group-name')).toBeFocused()
    await page.keyboard.type(groupName)
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('cell', { name: groupName })).toBeVisible()

    await page.goto(`/supplier/products/${productId}/edit`)
    await page.getByTestId('product-group-select').click()
    await page.getByRole('option', { name: groupName }).click()
    await page.getByRole('button', { name: 'Uložit změny' }).click()
    await expect(page).toHaveURL(/\/supplier\/products$/)

    await page.goto('/supplier/product-groups')
    const row = page.locator('tr', { hasText: groupName })
    await expect(row).toContainText(productName)

    await row.getByRole('button', { name: 'Smazat' }).click()
    await page.locator('.p-confirmdialog').getByRole('button', { name: 'Smazat' }).click()
    await expect(page.getByRole('cell', { name: groupName })).toHaveCount(0)
  })
})
