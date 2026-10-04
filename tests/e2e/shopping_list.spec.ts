import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './helpers/auth'
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
  await dialog.getByTestId('shopping-add-mode').click()
  await page.getByRole('option', { name: 'Vlastní položka' }).click()
  await dialog.locator('#shopping-add-label').fill(label)
  await dialog.locator('#shopping-add-quantity').fill(quantity)
  await dialog.getByTestId('shopping-add-submit').click()
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
    await loginAs(page, 'supplier')
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

  test('the horizon slider plans for another trip length and goes back to the habit', async ({
    page,
  }) => {
    await loginAs(page, 'supplier')
    await openShoppingList(page)

    const label = page.getByTestId('shopping-horizon-label')
    const before = (await label.textContent())!.trim()
    const slider = page.getByRole('slider', { name: 'Na kolik dní nakupuješ' })
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
    await loginAs(page, 'supplier')
    const name = `E2E Seznam ${Date.now()}`
    const productId = await createProduct(page, name)
    // The product is stocked through the list below, not through the manual draft.
    await discardDraft(page)
    await openShoppingList(page)

    await page.getByTestId('shopping-add-line').click()
    const dialog = page.getByTestId('shopping-add-dialog')
    await dialog.getByTestId('shopping-add-product').click()
    await page.locator('.p-select-filter').fill(name)
    await page.getByRole('option', { name }).click()
    await dialog.locator('#shopping-add-quantity').fill('6')
    await dialog.locator('#shopping-add-cost').fill('12,9')
    await dialog.getByTestId('shopping-add-submit').click()
    await expect(dialog).toBeHidden()

    const line = page.getByTestId(`shopping-line-p-${productId}`)
    await expect(line).toBeVisible()
    await expect(line).toContainText('12,90 Kč')
    // Only ticked lines go to the draft when anything is ticked.
    await line.locator('input[type="checkbox"]').click()
    await expect(line).toHaveClass(/opacity-70/)

    await page.getByTestId('shopping-complete').click()
    await page
      .locator('.p-confirmdialog')
      .getByRole('button', { name: 'Připravit naskladnění' })
      .click()
    await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+$/)

    // One line for the product plus the trailing empty line waiting for the next product.
    const lines = page.locator(
      '[data-testid="draft-row"][data-product-id]:not([data-product-id=""])'
    )
    await expect(lines).toHaveCount(1)
    await expect(lines.first()).toContainText(name)
    await expect(page.getByTestId('draft-row-price').first()).toHaveAttribute(
      'placeholder',
      'návrh 13'
    )

    // The button says what it does; there is no second confirmation.
    const commit = page.getByTestId('draft-commit')
    await expect(commit).toHaveText(/Naskladnit \(1 položka · 6 ks\)/)
    await commit.click()
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
    await loginAs(page, 'supplier')
    const name = `E2E Návrh ${Date.now()}`
    const productId = await createProduct(page, name)
    const line = page.locator(`[data-testid="draft-row"][data-product-id="${productId}"]`)

    // The new product has no price yet; the empty trailing line is not a problem.
    await expect(line.getByTestId('draft-row-problem')).toHaveText(
      'Zadej prodejní nebo nákupní cenu.'
    )
    await expect(page.getByText('Vyber produkt.')).toHaveCount(0)
    await expect(page.getByTestId('draft-commit')).toBeDisabled()

    const price = line.getByTestId('draft-row-price')
    await price.fill('25')
    await price.press('Enter')
    await expect(page.getByTestId('draft-commit')).toBeEnabled()
    await page.keyboard.press('Escape')

    await page.getByTestId('draft-discard').click()
    await page.locator('.p-confirmdialog').getByRole('button', { name: 'Zahodit' }).click()
    await expect(page).toHaveURL(/\/supplier\/stock\/drafts$/)
    await expect(page.getByText('Příjemka byla zahozena.')).toBeVisible()
  })
})

test.describe('Supplier purchase groups', () => {
  test('a group is created, filled from the product form and deleted', async ({ page }) => {
    await loginAs(page, 'supplier')
    const productName = `E2E Člen ${Date.now()}`
    const productId = await createProduct(page, productName)
    // Not stocking here — leave no half-filled line behind for the next test.
    await discardDraft(page)
    const groupName = `E2E Skupina ${Date.now()}`

    await page.goto('/supplier/product-groups')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    // Groups are a tab of the products page; the explanation sits behind the (i).
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Produkty')
    await expect(page.getByTestId('tab-product-groups')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('Skupina spojí zaměnitelné produkty —')).toHaveCount(0)
    await page.getByTestId('groups-hint').click()
    await expect(page.getByRole('dialog')).toContainText('zaměnitelné produkty')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByTestId('group-create').click()
    const dialog = page.getByTestId('group-dialog')
    await dialog.locator('#group-name').fill(groupName)
    await dialog.getByTestId('group-save').click()
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
