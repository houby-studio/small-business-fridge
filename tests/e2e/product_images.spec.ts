import { test, expect, type Page } from '@playwright/test'
import sharp from 'sharp'
import { loginAs } from './helpers/auth'

/** A red "product" on a white backdrop, the typical e-shop picture. */
async function whiteBackdropPng(width = 60, height = 100): Promise<Buffer> {
  const product = await sharp({
    create: { width, height, channels: 4, background: { r: 200, g: 30, b: 40, alpha: 1 } },
  })
    .png()
    .toBuffer()
  return sharp({
    create: { width: width + 40, height: height + 40, channels: 4, background: '#ffffff' },
  })
    .composite([{ input: product, left: 20, top: 20 }])
    .png()
    .toBuffer()
}

async function fillRequiredFields(page: Page, name: string) {
  await page.locator('#product-name').fill(name)
  await page.locator('#product-description').fill('E2E obrázek produktu')
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Nealko' }).click()
}

test.describe('Product image tile', () => {
  test('an untouched form lists what is missing instead of shouting errors', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')
    await expect(page.getByTestId('product-form-missing')).toHaveText(
      'Doplňte: Název produktu, Popis, Kategorie, Obrázek'
    )
    await expect(page.getByText('Popis produktu je povinný.')).toHaveCount(0)
    await expect(page.locator('#product-barcode')).toBeFocused()
  })

  test('an upload is processed, previewed and saved as WebP', async ({ page }) => {
    const name = `E2E Obrázek ${Date.now()}`
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')
    await fillRequiredFields(page, name)

    const createButton = page.getByRole('button', { name: 'Vytvořit produkt' })
    await page.locator('input[type="file"]').setInputFiles({
      name: 'white.png',
      mimeType: 'image/png',
      buffer: await whiteBackdropPng(),
    })

    const status = page.getByTestId('product-image-status')
    await expect(status).toHaveText('Hotovo: pozadí odstraněno')
    await expect(page.getByTestId('product-image-preview')).toHaveAttribute('src', /^blob:/)
    await expect(createButton).toBeEnabled()

    // The background toggle reprocesses the same picture.
    await page.getByText('S pozadím', { exact: true }).click()
    await expect(status).toHaveText('Hotovo: pozadí ponecháno')

    await createButton.click()
    await expect(page).toHaveURL(/\/supplier\/stock\?preselect=\d+/)
    const productId = page.url().match(/preselect=(\d+)/)![1]

    await page.goto(`/supplier/products/${productId}/edit`)
    await expect(page.getByTestId('product-image-preview')).toHaveAttribute(
      'src',
      /^\/uploads\/products\/[0-9a-f-]+\.webp$/
    )
    await expect(page.getByText('Uložený obrázek')).toBeVisible()
  })

  test('a wide product stands upright and the arrows turn it further', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'bar.png',
      mimeType: 'image/png',
      buffer: await whiteBackdropPng(240, 50),
    })
    const status = page.getByTestId('product-image-status')
    await expect(status).toHaveText('Hotovo: pozadí odstraněno, otočeno')

    await page.getByRole('button', { name: 'Nevypadá to dobře?' }).click()
    await page.getByRole('button', { name: 'Neotáčet' }).click()
    await expect(status).toHaveText('Hotovo: pozadí odstraněno')

    await page.getByRole('button', { name: 'Otočit doprava' }).click()
    await expect(status).toHaveText('Hotovo: pozadí odstraněno, otočeno')
  })

  test('a pasted image is picked up without choosing a file', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')
    const image = await whiteBackdropPng()
    const png = image.toString('base64')
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }))
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }))
    }, png)
    await expect(page.getByTestId('product-image-status')).toHaveText('Hotovo: pozadí odstraněno')
  })

  test('a link into the internal network is refused with a message', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')
    await page.getByRole('button', { name: 'Z odkazu' }).click()
    await page.locator('#product-image-url').fill('http://127.0.0.1:9/secret.png')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('product-image-error')).toContainText(
      'Z této adresy obrázek stáhnout nejde.'
    )
    await expect(page.getByRole('button', { name: 'Vytvořit produkt' })).toBeDisabled()
  })

  test('the barcode lookup explains what it needs', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')
    await page.getByRole('button', { name: 'Najít' }).click()
    await expect(page.getByText('Nejdřív zadejte čárový kód (8–14 číslic).')).toBeVisible()
  })

  test('the edit form improves the saved image and can restore it', async ({ page }) => {
    const name = `E2E Vylepšit ${Date.now()}`
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')
    await fillRequiredFields(page, name)
    await page.locator('input[type="file"]').setInputFiles({
      name: 'keep.png',
      mimeType: 'image/png',
      buffer: await whiteBackdropPng(),
    })
    const status = page.getByTestId('product-image-status')
    await expect(status).toHaveText('Hotovo: pozadí odstraněno')
    await page.getByText('S pozadím', { exact: true }).click()
    await expect(status).toHaveText('Hotovo: pozadí ponecháno')
    await page.getByRole('button', { name: 'Vytvořit produkt' }).click()
    await expect(page).toHaveURL(/\/supplier\/stock\?preselect=\d+/)
    const productId = page.url().match(/preselect=(\d+)/)![1]

    await page.goto(`/supplier/products/${productId}/edit`)
    await expect(page.getByText('Uložený obrázek')).toBeVisible()
    await page.getByText('Bez pozadí', { exact: true }).click()
    await expect(status).toHaveText('Hotovo: pozadí odstraněno')
    await expect(page.getByTestId('product-form-image-replaced')).toBeVisible()

    await page.getByRole('button', { name: 'Vrátit původní' }).click()
    await expect(page.getByText('Uložený obrázek')).toBeVisible()
    await expect(page.getByTestId('product-form-image-replaced')).toHaveCount(0)

    await page.getByText('Bez pozadí', { exact: true }).click()
    await expect(status).toHaveText('Hotovo: pozadí odstraněno')
    await page.getByRole('button', { name: 'Uložit změny' }).click()
    await expect(page).toHaveURL(/\/supplier\/stock/)
  })
})

test.describe('Barcode lookup', () => {
  /** The form's own props, to answer with ids that exist in the e2e database. */
  async function pageProps(page: Page) {
    return page.evaluate(
      () =>
        history.state.page.props as {
          categories: { id: number; name: string }[]
          allergens: { id: number; name: string }[]
        }
    )
  }

  test('fills the name, category and allergens and keeps the found name one click away', async ({
    page,
  }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')
    await page.locator('#product-barcode').waitFor()
    const props = await pageProps(page)
    const category = props.categories.find((c) => c.name === 'Nealko')!
    const allergen = props.allergens.find((a) => a.name === 'Mléko')!

    await page.route('**/supplier/products/image/candidates?**', (route) =>
      route.fulfill({
        json: {
          productName: 'Snickers 50 g',
          candidates: [],
          facts: {
            name: 'Snickers 50 g',
            categories: null,
            ingredients: null,
            allergens: ['milk'],
          },
        },
      })
    )
    await page.route('**/supplier/products/suggest', (route) =>
      route.fulfill({
        json: {
          categoryId: category.id,
          allergenIds: [allergen.id],
          allergensFrom: 'openfoodfacts',
        },
      })
    )

    await page.locator('#product-barcode').fill('5900951311505')
    await page.keyboard.press('Enter')

    const chip = page.getByTestId('barcode-lookup-name')
    await expect(page.locator('#product-name')).toHaveValue('Snickers 50 g')
    await expect(chip).toHaveAttribute('aria-label', 'Název je doplněný')
    await expect(page.getByText('Navrženo umělou inteligencí')).toBeVisible()
    await expect(page.getByText('Podle Open Food Facts — zkontrolujte na obalu')).toBeVisible()
    await expect(page.locator('#product-category')).toContainText('Nealko')

    // Clearing the name turns the chip into "fill in", and a click brings it back.
    await page.locator('#product-name').fill('')
    await expect(chip).toHaveAttribute('aria-label', 'Doplnit název: Snickers 50 g')
    await chip.click()
    await expect(page.locator('#product-name')).toHaveValue('Snickers 50 g')

    // A name the supplier typed is never overwritten by a new lookup.
    await page.locator('#product-name').fill('Můj Snickers')
    await page.getByRole('button', { name: 'Najít' }).click()
    await expect(chip).toHaveAttribute('aria-label', 'Doplnit název: Snickers 50 g')
    await expect(page.locator('#product-name')).toHaveValue('Můj Snickers')
  })

  test('an unknown barcode says so and changes nothing', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')
    await page.route('**/supplier/products/image/candidates?**', (route) =>
      route.fulfill({ json: { productName: null, candidates: [], facts: null } })
    )
    await page.locator('#product-barcode').fill('12345678')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Tento kód Open Food Facts nezná.')).toBeVisible()
    await expect(page.locator('#product-name')).toHaveValue('')
  })

  test('the suggest button only exists when AI is configured', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')
    await page.locator('#product-name').waitFor()
    await expect(page.getByTestId('product-suggest-description')).toHaveCount(0)
  })
})

test.describe('Kiosk product images', () => {
  test('the kiosk shows the whole product instead of cropping it square', async ({ page }) => {
    const name = `E2E Kiosk obrázek ${Date.now()}`
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')
    await fillRequiredFields(page, name)
    await page.locator('input[type="file"]').setInputFiles({
      name: 'kiosk.png',
      mimeType: 'image/png',
      buffer: await whiteBackdropPng(),
    })
    await page.getByRole('button', { name: 'Vytvořit produkt' }).click()
    await expect(page).toHaveURL(/\/supplier\/stock\?preselect=\d+/)
    await page.getByPlaceholder('ks').fill('2')
    await page.keyboard.press('Enter')
    await page.getByPlaceholder('Kč').fill('25')
    await page.keyboard.press('Enter')
    await expect(page.getByText(name).first()).toBeVisible()

    await loginAs(page, 'kiosk')
    await page.goto('/kiosk/shop?keypadId=89992')
    const image = page.getByRole('img', { name })
    await expect(image).toBeVisible()
    await expect(image).toHaveCSS('object-fit', 'contain')
  })
})
