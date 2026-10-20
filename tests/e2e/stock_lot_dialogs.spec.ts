import { test, expect, type Locator, type Page } from '@playwright/test'
import { loginAs } from './helpers/auth'
import { createProduct, stockPreselected } from './helpers/products'
import { createIsolatedSupplier, loginAsIsolated, queryDb } from './helpers/isolated_supplier'

/**
 * Sklad › Stav: "Změnit cenu" and "Odepsat" list the lots of the product in the order they
 * sell (oldest first, every supplier). Each test stocks a product of its own as an isolated
 * supplier and adds a colleague's lot that is OLDER, so it is the first to sell and to be
 * written off. Set A2_SHOTS=<dir> to also save screenshots of both dialogs.
 */

const PHONE = { width: 390, height: 844 }
const SHOTS = process.env.A2_SHOTS

async function shot(page: Page, file: string) {
  if (!SHOTS) return
  // Let the dialog finish fading in.
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${SHOTS}/${file}`, fullPage: false })
}

/** My 5 pieces at 20 Kč, and a colleague's 2 pieces at 22 Kč stocked a day earlier. */
async function sharedProduct(page: Page, tag: string) {
  const me = await createIsolatedSupplier(`lots-${tag}`)
  const colleague = await createIsolatedSupplier(`lots-${tag}-colleague`)
  await loginAsIsolated(page, me)
  const name = `000 E2E ${tag} ${Date.now()}`
  const productId = await createProduct(page, name)
  await stockPreselected(page, '5', '20')
  const [theirs] = await queryDb<{ id: number }>(
    `INSERT INTO deliveries (supplier_id, product_id, amount_supplied, amount_left, price,
       created_at, updated_at)
     VALUES ($1, $2, 2, 2, 22, NOW() - INTERVAL '1 day', NOW()) RETURNING id`,
    [colleague.id, productId]
  )
  // A category of the test's own keeps the row on the first page of "Celá lednice".
  const [category] = await queryDb<{ id: number }>(
    `INSERT INTO categories (name, color, is_disabled, created_at, updated_at)
     VALUES ($1, '#6b7280', false, NOW(), NOW()) RETURNING id`,
    [`E2E Kategorie ${tag} ${Date.now()}`]
  )
  await queryDb('UPDATE products SET category_id = $1 WHERE id = $2', [category.id, productId])
  return {
    me,
    colleague,
    name,
    productId,
    theirs: theirs.id,
    url: `/supplier/stock?categoryId=${category.id}`,
  }
}

async function openStock(page: Page, url: string) {
  await page.goto(url)
  await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
}

async function pricesOf(productId: number) {
  return queryDb<{ supplier_id: number; amount_left: number; price: number }>(
    `SELECT supplier_id, amount_left, price FROM deliveries
     WHERE product_id = $1 AND voided_at IS NULL ORDER BY created_at, id`,
    [productId]
  )
}

const takes = (dialog: Locator) =>
  dialog.getByTestId('write-off-lot').getByTestId('write-off-lot-take')

test.describe('Stock lot dialogs', () => {
  test('Změnit cenu: the shortcut fills my lots, one row can differ, a colleague’s is read-only', async ({
    page,
  }) => {
    const { me, colleague, name, productId, url } = await sharedProduct(page, 'Cena')
    // A second lot of mine at another price, so "all of mine" really fills two rows.
    await queryDb(
      `INSERT INTO deliveries (supplier_id, product_id, amount_supplied, amount_left, price,
         created_at, updated_at)
       VALUES ($1, $2, 3, 3, 21, NOW(), NOW())`,
      [me.id, productId]
    )
    await openStock(page, url)
    const row = page.locator('tr', { hasText: name })
    await row.getByTestId('stock-row-reprice').click()
    const dialog = page.getByTestId('reprice-dialog')
    const lots = dialog.getByTestId('reprice-lot')
    await expect(lots).toHaveCount(3)
    // Oldest first, marked as the one that sells first: the colleague's, read-only for me.
    await expect(lots.nth(0)).toContainText(colleague.name)
    await expect(lots.nth(0).getByTestId('reprice-lot-first')).toHaveText('prodává se první')
    await expect(lots.nth(0).getByTestId('reprice-lot-readonly')).toHaveText('22 Kč')
    await expect(lots.nth(1).getByTestId('reprice-lot-price').locator('input')).toHaveValue('20 Kč')
    await expect(lots.nth(2).getByTestId('reprice-lot-price').locator('input')).toHaveValue('21 Kč')
    await expect(dialog.getByTestId('reprice-confirm')).toBeDisabled()
    await shot(page, 'reprice-desktop.png')

    await expect(dialog.locator('#reprice-all')).toBeFocused()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('15')
    await page.keyboard.press('Enter')
    await expect(lots.nth(1).getByTestId('reprice-lot-price').locator('input')).toHaveValue('15 Kč')
    await expect(lots.nth(2).getByTestId('reprice-lot-price').locator('input')).toHaveValue('15 Kč')
    // The newest lot stays a little dearer.
    const newest = lots.nth(2).getByTestId('reprice-lot-price').locator('input')
    await newest.fill('17')
    await newest.blur()
    await expect(dialog.getByTestId('reprice-summary')).toHaveText(
      'Změní se 2 dodávky · 8 ks na skladě'
    )
    await dialog.getByTestId('reprice-confirm').click()
    await expect(page.getByText('Cena změněna u 2 dodávek (8 ks na skladě).')).toBeVisible()
    await expect(dialog).toBeHidden()

    expect(await pricesOf(productId)).toEqual([
      { supplier_id: colleague.id, amount_left: 2, price: 22 },
      { supplier_id: me.id, amount_left: 5, price: 15 },
      { supplier_id: me.id, amount_left: 3, price: 17 },
    ])
  })

  test('Změnit cenu: an admin may change a colleague’s lot', async ({ page }) => {
    const { colleague, name, productId, url } = await sharedProduct(page, 'Admin')
    await loginAs(page, 'admin')
    await openStock(page, url)
    const row = page.locator('tr', { hasText: name })
    await row.getByTestId('stock-row-reprice').click()
    const dialog = page.getByTestId('reprice-dialog')
    const lots = dialog.getByTestId('reprice-lot')
    await expect(lots).toHaveCount(2)
    // The admin has no lot of their own here: no "all of mine", every lot editable.
    await expect(dialog.locator('#reprice-all')).toHaveCount(0)
    await expect(dialog.getByTestId('reprice-lot-readonly')).toHaveCount(0)
    const theirs = lots.nth(0).getByTestId('reprice-lot-price').locator('input')
    await theirs.fill('12')
    await theirs.blur()
    await dialog.getByTestId('reprice-confirm').click()
    await expect(page.getByText('Cena změněna u 1 dodávky (2 ks na skladě).')).toBeVisible()
    const after = await pricesOf(productId)
    expect(after.map((lot) => [lot.supplier_id, lot.price])).toEqual([
      [colleague.id, 12],
      [expect.any(Number), 20],
    ])
  })

  test('Odepsat: the preview follows the quantity and names the colleague who is e-mailed', async ({
    page,
  }) => {
    const { colleague, name, url } = await sharedProduct(page, 'Odpis')
    await openStock(page, url)
    const row = page.locator('tr', { hasText: name })
    await row.getByTestId('stock-row-write-off').click()
    const dialog = page.getByTestId('write-off-dialog')
    const lots = dialog.getByTestId('write-off-lot')
    await expect(lots).toHaveCount(2)

    // 1 piece: off the colleague's (older) lot — they will hear about it.
    await expect(takes(dialog)).toHaveText(['−1 ks', ''], { useInnerText: true })
    // The name is in the row already; the note only says the e-mail goes out.
    await expect(lots.nth(0)).toContainText(colleague.name)
    await expect(lots.nth(0).getByTestId('write-off-lot-notified')).toHaveText('dostane e-mail')
    // 4 pieces: the colleague's 2, then 2 of mine — no note on my own lot.
    await setNumber(page.locator('#write-off-quantity'), '4')
    await expect(takes(dialog)).toHaveText(['−2 ks', '−2 ks'], { useInnerText: true })
    await expect(dialog.getByTestId('write-off-lot-notified')).toHaveCount(1)
    await shot(page, 'write-off-desktop.png')
    // More than the shelf holds: no preview, and the confirm is off.
    await setNumber(page.locator('#write-off-quantity'), '8')
    await expect(dialog.getByTestId('write-off-confirm')).toBeDisabled()
    await expect(takes(dialog)).toHaveText(['', ''], { useInnerText: true })

    await setNumber(page.locator('#write-off-quantity'), '3')
    await dialog.getByTestId('write-off-confirm').click()
    await expect(page.getByText('Odepsáno 3 ks.')).toBeVisible()
    await expect(dialog).toBeHidden()
  })

  test('mixed stock: the row splits its pieces, and every stock tab starts on the whole fridge', async ({
    page,
  }) => {
    const { name, url } = await sharedProduct(page, 'Smisene')
    // PLAN4 P1: no scope in the URL = "Celá lednice" on all three tabs.
    await openStock(page, url)
    await expect(page.getByTestId('stock-scope')).toContainText('Celá lednice')
    const row = page.locator('tr', { hasText: name })
    await expect(row.locator('td').nth(1)).toContainText('7 ks')
    await expect(row.getByTestId('stock-mixed')).toHaveText('z toho moje 5')
    await expect(page.getByTestId('stock-scope-hint')).toBeVisible()

    await openStock(page, `${url}&scope=mine`)
    const mine = page.locator('tr', { hasText: name })
    await expect(mine.locator('td').nth(1)).toContainText('5 ks')
    await expect(mine.getByTestId('stock-mixed')).toHaveText('v lednici celkem 7')

    for (const [path, testId] of [
      ['/supplier/deliveries', 'deliveries-scope'],
      ['/supplier/inventory', 'inventory-scope'],
    ] as const) {
      await openStock(page, path)
      await expect(page.getByTestId(testId)).toContainText('Celá lednice')
    }
  })

  test('both dialogs fit a phone: stacked rows, no sideways scroll', async ({ page }) => {
    const { name, url } = await sharedProduct(page, 'Mobil')
    await page.setViewportSize(PHONE)
    await openStock(page, url)
    const row = page.locator('tr', { hasText: name })

    await row.getByTestId('stock-row-actions').click()
    await page.getByTestId('stock-menu-reprice').click()
    const reprice = page.getByTestId('reprice-dialog')
    await expect(reprice.getByTestId('reprice-lot')).toHaveCount(2)
    await expectInside(reprice)
    await expect(reprice.getByTestId('reprice-lot-price').locator('input')).toBeInViewport()
    await shot(page, 'reprice-mobile.png')
    await reprice.getByRole('button', { name: 'Zrušit' }).click()

    await row.getByTestId('stock-row-actions').click()
    await page.getByTestId('stock-menu-write-off').click()
    const writeOff = page.getByTestId('write-off-dialog')
    await expect(writeOff.getByTestId('write-off-lot')).toHaveCount(2)
    await setNumber(page.locator('#write-off-quantity'), '3')
    await expect(takes(writeOff)).toHaveText(['Odepíše se: −2 ks', 'Odepíše se: −1 ks'], {
      useInnerText: true,
    })
    await expectInside(writeOff)
    await shot(page, 'write-off-mobile.png')
  })
})

/** A NumberInput takes its value on blur (as a user leaving the field). */
async function setNumber(input: Locator, value: string) {
  await input.fill(value)
  await input.blur()
}

async function expectInside(dialog: Locator) {
  const box = await dialog.boundingBox()
  if (!box) throw new Error('dialog not rendered')
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width)
  const overflow = await dialog.evaluate((el) => {
    const content = el.querySelector('.p-dialog-content') as HTMLElement | null
    return content ? content.scrollWidth - content.clientWidth : 0
  })
  expect(overflow, 'the dialog content scrolls sideways').toBeLessThanOrEqual(0)
}
