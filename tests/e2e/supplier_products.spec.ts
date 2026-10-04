import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'
import { commitDraft, createProduct, discardDraft } from './helpers/products'

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
    await page.locator('#product-description').fill('E2E popis produktu')

    await page.locator('#product-barcode').fill('1'.repeat(101))
    await expect(page.getByText('Čárový kód může mít maximálně 100 znaků.')).toBeVisible()
    await expect(createButton).toBeDisabled()
    await page.locator('#product-barcode').fill('')

    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Nealko' }).click()

    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-validation.png',
      mimeType: 'image/png',
      buffer: PIXEL_PNG,
    })

    await expect(createButton).toBeEnabled()
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

    await loginAs(page, 'supplier')

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
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')
    await expect(page.locator('#product-name')).toBeVisible()

    const productId = await createProduct(page, `E2E Fokus ${Date.now()}`)
    await discardDraft(page)
    await page.goto(`/supplier/products/${productId}/edit`)
    await expect(page.locator('#edit-product-name')).toBeVisible()
  })

  test('groups are a tab of the products page and a row stocks its product', async ({ page }) => {
    const name = `E2E Řádek ${Date.now()}`

    await loginAs(page, 'supplier')
    const productId = await createProduct(page, name)
    await discardDraft(page)

    await page.goto('/supplier/products')
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Produkty')
    await expect(page.getByTestId('tab-products')).toHaveAttribute('aria-selected', 'true')
    await page.getByTestId('tab-product-groups').click()
    await expect(page).toHaveURL(/\/supplier\/product-groups$/)
    await expect(page.getByTestId('tab-product-groups')).toHaveAttribute('aria-selected', 'true')
    await page.getByTestId('tab-products').click()
    await expect(page).toHaveURL(/\/supplier\/products$/)

    // "Naskladnit" on a row puts the product on the supplier's draft and focuses its amount.
    await page.goto(`/supplier/products?search=${encodeURIComponent(name)}`)
    await expect(page.locator('#sbf-boot-loader')).toHaveCount(0)
    const row = page.locator('tbody tr', { hasText: name })
    await expect(row).toHaveCount(1)
    await expect(row.getByRole('button', { name: 'Upravit' })).toBeVisible()
    await row.getByTestId('product-row-receive').click()
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

    await loginAs(page, 'supplier')
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

    await loginAs(page, 'supplier')
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
})
