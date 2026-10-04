import { test, expect, type Page } from '@playwright/test'
import { loginAs } from './helpers/auth'
import { commitDraft, createProduct, stockPreselected, stockProduct } from './helpers/products'

/** The count on the "Naskladnění" badge in the supplier menu (0 when there is none). */
async function receivingBadgeCount(page: Page): Promise<number> {
  await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
  await page.locator('.sbf-nav').getByText('Dodavatel', { exact: true }).click()
  const badge = page.getByTestId('nav-receiving-badge')
  const count = (await badge.count()) ? Number((await badge.textContent())!.trim()) : 0
  await page.keyboard.press('Escape')
  return count
}

test.describe('Stock receiving (příjemka)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
  })

  test('a new product is stocked in three interactions from the product form', async ({ page }) => {
    await loginAs(page, 'supplier')
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

  test('an existing product is stocked from the stock page by typing its name', async ({
    page,
  }) => {
    await loginAs(page, 'supplier')
    await stockProduct(page, 'Coca-Cola 0.5L', '2', '25')

    await page.goto('/supplier/deliveries')
    const row = page.locator('tbody tr').first()
    await expect(row).toContainText('Coca-Cola 0.5L')
    await expect(row).toContainText('2 ks')
    await expect(row).toContainText('25 Kč')
  })

  test('stocking the same product twice shows the warning and "Stock anyway" works', async ({
    page,
  }) => {
    await loginAs(page, 'supplier')
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
    await expect(page.getByRole('tab', { name: 'Stav' })).toHaveAttribute('aria-selected', 'true')

    await page.getByRole('tab', { name: 'Historie' }).click()
    await expect(page).toHaveURL(/\/supplier\/deliveries$/)
    await expect(page.getByRole('heading', { name: 'Sklad' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Historie' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    // A tab page keeps its menu entry lit — "Sklad", not "Naskladnění".
    await page.locator('.sbf-nav').getByText('Dodavatel', { exact: true }).click()
    await expect(page.locator('.sbf-nav-active', { hasText: 'Sklad' }).first()).toBeVisible()
    await expect(page.locator('.sbf-nav-active', { hasText: 'Naskladnění' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.getByRole('tab', { name: 'Inventura' }).click()
    await expect(page).toHaveURL(/\/supplier\/inventory$/)

    await page.goto('/supplier/deliveries')
    await page.getByRole('tab', { name: 'Stav' }).click()
    await expect(page).toHaveURL(/\/supplier\/stock$/)
  })

  test('the history lists write-offs under their own type', async ({ page }) => {
    await loginAs(page, 'supplier')
    // Leading zeros sort it onto the first page of the stock table.
    const name = `000 E2E Odpis ${Date.now()}`
    const productId = await createProduct(page, name)
    await stockPreselected(page, '5', '20')

    await page.goto('/supplier/stock')
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
    await page.getByRole('button', { name: 'Použít filtry' }).click()
    await expect(page).toHaveURL(/type=adjustments/)
    const adjustments = page.getByTestId('history-adjustments')
    await expect(adjustments).toBeVisible()
    const writeOff = adjustments.locator('tbody tr', { hasText: name }).first()
    await expect(writeOff.getByTestId('adjustment-quantity')).toHaveText('−1 ks')
    await expect(writeOff).toContainText('Prošlé')

    await page.goto(`/supplier/deliveries?type=adjustments&productId=${productId}`)
    await expect(page.getByTestId('history-adjustments').locator('tbody tr')).toHaveCount(1)
  })

  test('the menu badge counts drafts with lines and clears once they are stocked', async ({
    page,
  }) => {
    await loginAs(page, 'supplier')
    const before = await receivingBadgeCount(page)

    const name = `E2E Badge ${Date.now()}`
    await createProduct(page, name)
    const draftId = page.url().match(/drafts\/(\d+)/)![1]

    await page.goto('/supplier/stock')
    const chip = page.getByTestId('stock-drafts-waiting')
    await expect(chip).toContainText(String(before + 1))
    expect(await receivingBadgeCount(page)).toBe(before + 1)

    await chip.click()
    await expect(page).toHaveURL(/\/supplier\/stock\/drafts$/)
    await page.getByTestId(`draft-${draftId}`).click()
    await expect(page).toHaveURL(new RegExp(`/supplier/stock/drafts/${draftId}$`))

    const price = page.getByTestId('draft-row-price').first()
    await price.fill('30')
    await price.press('Enter')
    await commitDraft(page)

    if (before === 0) {
      await expect(page.getByTestId('stock-drafts-waiting')).toHaveCount(0)
    } else {
      await expect(page.getByTestId('stock-drafts-waiting')).toContainText(String(before))
    }
    expect(await receivingBadgeCount(page)).toBe(before)
  })
})
