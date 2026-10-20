import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'
import { loginAsFreshSupplier } from './helpers/isolated_supplier'
import { commitDraft, createProduct, discardDraft, stockPreselected } from './helpers/products'

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAGCAYAAADkOT91AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVR4nGM4IafxHxkz0EIAAMbhMTmfCC9yAAAAAElFTkSuQmCC',
  'base64'
)

test.describe('Supplier products flow', () => {
  test('new product form enforces client-side validation', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')

    const createButton = page.getByRole('button', { name: 'Vytvořit produkt' })
    await expect(createButton).toBeDisabled()

    await page.locator('#product-name').fill('x'.repeat(256))
    await expect(page.getByText('Název produktu může mít maximálně 255 znaků.')).toBeVisible()
    await expect(createButton).toBeDisabled()

    await page.locator('#product-name').fill(`E2E Validace ${Date.now()}`)

    await page.locator('#product-barcode').fill('1'.repeat(101))
    await expect(page.getByText('Čárový kód může mít maximálně 100 znaků.')).toBeVisible()
    await expect(createButton).toBeDisabled()
    await page.locator('#product-barcode').fill('')

    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Nealko' }).click()

    // Name and category are enough: the photo and the description are optional.
    await expect(createButton).toBeEnabled()
    await expect(page.getByTestId('product-form-missing')).toHaveCount(0)
  })

  test('edit product form enforces client-side validation', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products')

    await page.locator('tbody tr button:has(.pi-pencil)').first().click()
    await expect(page).toHaveURL(/\/supplier\/products\/\d+\/edit/)

    const saveButton = page.getByRole('button', { name: 'Uložit změny' })
    await expect(saveButton).toBeEnabled()

    await page.locator('#edit-product-name').fill('')
    await expect(page.getByText('Název produktu je povinný.')).toBeVisible()
    await expect(saveButton).toBeDisabled()

    await page.locator('#edit-product-name').fill(`E2E Upraveno ${Date.now()}`)
    await expect(saveButton).toBeEnabled()
  })

  test('saving the edit form persists the change', async ({ page }) => {
    const createdName = `E2E Editace ${Date.now()}`
    const renamedTo = `${createdName} upraveno`

    await loginAsFreshSupplier(page, 'supplier-products')

    // Work on an own product so the seeded catalogue stays untouched.
    const productId = await createProduct(page, createdName)
    await discardDraft(page)

    await page.goto(`/supplier/products/${productId}/edit`)
    await page.locator('#edit-product-name').fill(renamedTo)
    await page.getByRole('button', { name: 'Uložit změny' }).click()

    await expect(page).toHaveURL(/\/supplier\/products$/)
    await expect(page.getByText(`Produkt „${renamedTo}“ byl upraven.`)).toBeVisible()

    // The change must really be persisted, not just flashed.
    await page.goto(`/supplier/products/${productId}/edit`)
    await expect(page.locator('#edit-product-name')).toHaveValue(renamedTo)
  })

  test('supplier products category tags keep white text color', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products')

    const categoryTag = page.locator('tbody tr .p-tag').first()
    await expect(categoryTag).toBeVisible()
    const color = await categoryTag.evaluate((el) => getComputedStyle(el).color)
    expect(color).toBe('rgb(255, 255, 255)')
  })

  test('create and edit pages expose keyboard-friendly name inputs', async ({ page }) => {
    await loginAsFreshSupplier(page, 'supplier-products')
    await page.goto('/supplier/products/new')
    await expect(page.locator('#product-name')).toBeVisible()

    const productId = await createProduct(page, `E2E Fokus ${Date.now()}`)
    await discardDraft(page)
    await page.goto(`/supplier/products/${productId}/edit`)
    await expect(page.locator('#edit-product-name')).toBeVisible()
  })

  test('groups are a tab of the products page and a row stocks its product', async ({ page }) => {
    const name = `E2E Řádek ${Date.now()}`

    await loginAsFreshSupplier(page, 'supplier-products')
    const productId = await createProduct(page, name)
    await discardDraft(page)

    await page.goto('/supplier/products')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Produkty')
    await expect(page.getByTestId('tab-products')).toHaveAttribute('aria-current', 'page')
    await page.getByTestId('tab-product-groups').click()
    await expect(page).toHaveURL(/\/supplier\/product-groups$/)
    await expect(page.getByTestId('tab-product-groups')).toHaveAttribute('aria-current', 'page')
    await page.getByTestId('tab-products').click()
    await expect(page).toHaveURL(/\/supplier\/products$/)

    // "Naskladnit" on a row puts the product on the supplier's draft and focuses its amount.
    await page.goto(`/supplier/products?search=${encodeURIComponent(name)}`)
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    const row = page.locator('tbody tr', { hasText: name })
    await expect(row).toHaveCount(1)
    await expect(row.getByRole('button', { name: 'Upravit' })).toBeVisible()
    // Icon-only buttons say what they do on hover too (aria-label doubles as title).
    await expect(row.getByTestId('product-row-receive')).toHaveAttribute('title', 'Naskladnit')
    await expect(row.getByTestId('product-row-edit')).toHaveAttribute('title', 'Upravit')
    // A double click puts the product on the draft once, not twice.
    await row.getByTestId('product-row-receive').dblclick()
    await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+\?focus=\d+/)
    await expect(
      page.locator(`[data-testid="draft-row"][data-product-id="${productId}"]`)
    ).toHaveCount(1)
    await expect(page.locator(':focus')).toHaveAttribute('placeholder', 'ks')

    await discardDraft(page)
  })

  test('creating a product lands on a stocking draft with its line and the amount focused', async ({
    page,
  }) => {
    const productName = `E2E Produkt ${Date.now()}`

    await loginAsFreshSupplier(page, 'supplier-products')
    await page.goto('/supplier/products/new')

    await page.getByPlaceholder('např. Coca-Cola 0.5l').fill(productName)
    await page.getByPlaceholder('Krátký popis produktu').fill('E2E testovací produkt')

    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Nealko' }).click()

    await page.locator('#product-barcode').fill(String(Date.now()))

    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-product.png',
      mimeType: 'image/png',
      buffer: PIXEL_PNG,
    })

    await page.getByRole('button', { name: 'Vytvořit produkt' }).click()
    await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+\?focus=\d+/)

    // The new product is already a line of the draft; the amount is focused so stocking
    // continues straight away. The trailing empty line waits for the next product.
    const rows = page.getByTestId('draft-row')
    await expect(rows.filter({ hasText: productName })).toHaveCount(1)
    await expect(rows.last()).toHaveAttribute('data-product-id', '')
    await expect(page.locator(':focus')).toHaveAttribute('placeholder', 'ks')

    await discardDraft(page)
  })

  test('the stocking draft supports the enter-first keyboard flow', async ({ page }) => {
    const productName = `E2E Keyboard ${Date.now()}`

    await loginAsFreshSupplier(page, 'supplier-products')
    await page.goto('/supplier/products/new')

    await page.locator('#product-name').click()
    await page.keyboard.press('Enter')
    await expect(page.locator('#product-description')).toBeFocused()

    await page.locator('#product-description').fill('Jedna radka')
    await page.keyboard.press('Enter')
    await page.getByRole('combobox').first().click()
    await expect(page.getByRole('option', { name: 'Nealko' })).toBeVisible()
    await page.getByRole('option', { name: 'Nealko' }).click()

    await page.locator('#product-name').fill(productName)
    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-keyboard.png',
      mimeType: 'image/png',
      buffer: PIXEL_PNG,
    })
    await page.getByRole('button', { name: 'Vytvořit produkt' }).click()
    await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+\?focus=\d+/)
    await expect(page.locator(':focus')).toHaveAttribute('placeholder', 'ks')

    await page.locator(':focus').fill('3')
    await page.keyboard.press('Enter')

    // Enter walks amount → purchase price (optional, may stay empty) → selling price.
    await expect(page.locator(':focus')).toHaveAttribute('placeholder', 'Kč')
    await page.keyboard.press('Enter')

    await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'draft-row-price')
    await page.locator(':focus').fill('49')
    await page.keyboard.press('Enter')

    // Enter in the price confirms the line and opens the product search of the empty one.
    // (.last(): the previous line's search may still be fading out.)
    const searchField = page.locator('.p-select-overlay .p-select-filter').last()
    await expect(searchField).toBeFocused()
    await searchField.fill(productName)
    await page.keyboard.press('Enter')

    // Two lines for the product now, plus the empty one waiting at the end.
    const rows = page.getByTestId('draft-row')
    await expect(rows.filter({ hasText: productName })).toHaveCount(2)
    await expect(rows.last()).toHaveAttribute('data-product-id', '')
    await expect(page.locator(':focus')).toHaveAttribute('placeholder', 'ks')
    await page.locator(':focus').fill('2')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.locator(':focus').fill('50')
    await page.keyboard.press('Enter')
    await expect(searchField).toBeFocused()
    await page.keyboard.press('Escape')

    await expect(page.getByTestId('draft-commit')).toHaveText(/Naskladnit \(2 položky · 5 ks\)/)
    await commitDraft(page)
    await expect(page.getByText('Naskladněno 5 ks (2 dodávky).')).toBeVisible()
  })

  test('the product list sorts on the server and keeps the sort while filtering', async ({
    page,
  }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)

    const codes = () =>
      page
        .locator('tbody tr')
        .evaluateAll((rows) =>
          rows.map((row) => Number(row.querySelector('td')?.textContent?.trim()))
        )

    await page
      .getByRole('columnheader', { name: /Kód v kiosku/ })
      .click({ position: { x: 8, y: 8 } })
    await expect(page).toHaveURL(/sortBy=keypadId&sortOrder=asc/)
    await expect
      .poll(async () => {
        const rows = await codes()
        return rows.length > 1 && rows.every((c, i) => i === 0 || rows[i - 1] < c)
      })
      .toBe(true)
    const ascending = await codes()

    await page
      .getByRole('columnheader', { name: /Kód v kiosku/ })
      .click({ position: { x: 8, y: 8 } })
    await expect(page).toHaveURL(/sortBy=keypadId&sortOrder=desc/)
    await expect
      .poll(async () => {
        const descending = await codes()
        return (
          descending[0] > ascending[0] &&
          descending.every((c, i) => i === 0 || descending[i - 1] > c)
        )
      })
      .toBe(true)
  })

  test('new and edit product pages go back with an icon left of the heading', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products')
    await page.goto('/supplier/products/new')
    const back = page.getByTestId('product-back')
    await expect(back).toHaveAccessibleName('Zpět')
    const backBox = await back.boundingBox()
    const headingBox = await page.getByRole('heading', { level: 1 }).boundingBox()
    expect(backBox!.x).toBeLessThan(headingBox!.x)
    await back.click()
    await expect(page).toHaveURL(/\/supplier\/products$/)
  })

  test('a product without a photo is marked, filtered, archived and restored', async ({ page }) => {
    const name = `E2E Bez fotky ${Date.now()}`
    await loginAsFreshSupplier(page, 'supplier-products')

    // Name and category are all it takes.
    await page.goto('/supplier/products/new')
    await page.locator('#product-name').fill(name)
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Nealko' }).click()
    await page.getByRole('button', { name: 'Vytvořit produkt' }).click()
    await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+\?focus=\d+/)
    // Off the open draft again, so the product can be archived.
    await discardDraft(page)

    await page.goto(`/supplier/products?search=${encodeURIComponent(name)}`)
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    const row = page.locator('tbody tr', { hasText: name })
    await expect(row.getByTestId('product-no-photo-badge')).toHaveText('bez fotky')
    await expect(row.getByTestId('product-image-placeholder')).toBeVisible()

    // The photo filter applies the moment it changes — there is no "Apply" button.
    await expect(page.getByRole('button', { name: 'Použít filtry' })).toHaveCount(0)
    await page.getByTestId('products-photo').click()
    await page.getByRole('option', { name: 'Bez fotky' }).click()
    await expect(page).toHaveURL(/photo=missing/)
    await expect(row).toHaveCount(1)

    // Archive: gone from the default (active) list, back under "Archivované".
    await expect(row.getByTestId('product-row-archive')).toHaveAttribute('title', 'Archivovat')
    await row.getByTestId('product-row-archive').click()
    await expect(page.getByText(`Produkt ${name} je archivovaný.`)).toBeVisible()
    await expect(row).toHaveCount(0)
    await expect(page).toHaveURL(/photo=missing/)

    await page.getByTestId('products-status').click()
    await page.getByRole('option', { name: 'Archivované' }).click()
    await expect(page).toHaveURL(/status=archived/)
    await expect(row.getByTestId('product-archived-badge')).toBeVisible()
    await row.getByTestId('product-row-unarchive').click()
    await expect(page.getByText(`Produkt ${name} je zpět v nabídce.`)).toBeVisible()
    await expect(row).toHaveCount(0)

    await page.getByTestId('filter-clear').click()
    await expect(page).not.toHaveURL(/status=|photo=/)
  })

  test('a product with stock cannot be archived and says why', async ({ page }) => {
    const name = `E2E Archiv sklad ${Date.now()}`
    await loginAsFreshSupplier(page, 'supplier-products')
    await createProduct(page, name)
    await stockPreselected(page, '2', '15')

    await page.goto(`/supplier/products?search=${encodeURIComponent(name)}`)
    const row = page.locator('tbody tr', { hasText: name })
    await row.getByTestId('product-row-archive').click()
    await expect(page.getByText('Produkt má ještě kusy na skladě.', { exact: false })).toBeVisible()
    await expect(row.getByTestId('product-archived-badge')).toHaveCount(0)
    await expect(row).toHaveCount(1)
  })

  test('the search runs while typing, once per text, and the code column explains itself', async ({
    page,
  }) => {
    const name = `E2E Hledání ${Date.now()}`
    await loginAsFreshSupplier(page, 'supplier-products')
    await createProduct(page, name)
    // (The product stays on the open draft — searching does not care.)

    await page.goto('/supplier/products')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)

    // "Kód v kiosku" says what the number is for behind an (i), without sorting the column.
    await page.getByTestId('keypad-code-hint').click()
    await expect(page.getByText('Číslo, které zákazník zadá na klávesnici kiosku.')).toBeVisible()
    await expect(page).not.toHaveURL(/sortBy=/)
    await page.keyboard.press('Escape')

    const searches: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname === '/supplier/products' && request.headers()['x-inertia']) {
        searches.push(url.searchParams.get('search') ?? '')
      }
    })

    // Typing searches by itself after a pause — one request for the whole word.
    const search = page.getByTestId('products-search')
    await search.click()
    await search.pressSequentially(name, { delay: 20 })
    await expect.poll(() => searches).toEqual([name])
    await expect(page).toHaveURL(/search=/)
    await expect(page.locator('tbody tr')).toHaveCount(1)

    // Enter and leaving the field with the same text send nothing more.
    await search.press('Enter')
    await search.blur()
    await page.waitForTimeout(600)
    expect(searches).toEqual([name])

    // Enter searches at once, without waiting for the pause.
    await search.fill('zzz-nic-takoveho')
    await search.press('Enter')
    await expect(page.locator('tbody tr', { hasText: name })).toHaveCount(0)
    await page.waitForTimeout(600)
    expect(searches).toEqual([name, 'zzz-nic-takoveho'])
  })
})
