import { test, expect, type Page } from '@playwright/test'
import sharp from 'sharp'
import { loginAs } from './helpers/auth'
import { loginAsFreshSupplier } from './helpers/isolated_supplier'
import { discardDraft, stockPreselected } from './helpers/products'

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

/** The product form lands on a stocking draft; the new product is the line that has an id. */
async function draftProductId(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/supplier\/stock\/drafts\/\d+\?focus=\d+/)
  const row = page.locator('[data-testid="draft-row"][data-product-id]:not([data-product-id=""])')
  await expect(row.first()).toBeVisible()
  return (await row.first().getAttribute('data-product-id'))!
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
      'Doplňte: Název produktu, Kategorie'
    )
    await expect(page.locator('#product-barcode')).toBeFocused()
  })

  test('an upload is processed, previewed and saved as WebP', async ({ page }) => {
    const name = `E2E Obrázek ${Date.now()}`
    await loginAsFreshSupplier(page, 'product-images')
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
    const productId = await draftProductId(page)
    await discardDraft(page)

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
    await loginAsFreshSupplier(page, 'product-images')
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
    const productId = await draftProductId(page)
    await discardDraft(page)

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
    await expect(page).toHaveURL(/\/supplier\/products$/)
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

  test('pictures pulse until they arrive and a broken one is dropped', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')
    await page.route('**/supplier/products/image/candidates?**', (route) =>
      route.fulfill({
        json: {
          productName: 'Mentos fruits 38g',
          candidates: [
            { url: 'https://off.e2e.test/slow.jpg', thumbUrl: 'https://off.e2e.test/slow.400.jpg' },
            { url: 'https://off.e2e.test/gone.jpg', thumbUrl: 'https://off.e2e.test/gone.400.jpg' },
          ],
          facts: null,
        },
      })
    )
    // The slow picture is held back until the test lets it through.
    let release!: () => void
    const released = new Promise<void>((resolve) => (release = resolve))
    const png = await whiteBackdropPng()
    await page.route('https://off.e2e.test/slow.400.jpg', async (route) => {
      await released
      await route.fulfill({ body: png, contentType: 'image/png' })
    })
    await page.route('https://off.e2e.test/gone.400.jpg', (route) => route.abort())

    await page.locator('#product-barcode').fill('87108026')
    await page.keyboard.press('Enter')

    const pictures = page.getByTestId('barcode-lookup-picture')
    await expect(pictures).toHaveCount(1)
    await expect(page.getByTestId('barcode-lookup-picture-loading')).toBeVisible()
    await expect(pictures.first()).toHaveAttribute('aria-busy', 'true')

    release()
    await expect(page.getByTestId('barcode-lookup-picture-loading')).toHaveCount(0)
    await expect(pictures.first()).toHaveAttribute('aria-busy', 'false')
  })

  test('says so when no picture could be loaded', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')
    await page.route('**/supplier/products/image/candidates?**', (route) =>
      route.fulfill({
        json: {
          productName: null,
          candidates: [
            { url: 'https://off.e2e.test/gone.jpg', thumbUrl: 'https://off.e2e.test/gone.400.jpg' },
          ],
          facts: null,
        },
      })
    )
    await page.route('https://off.e2e.test/gone.400.jpg', (route) => route.abort())
    await page.locator('#product-barcode').fill('87108026')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Fotky z Open Food Facts se nepodařilo načíst.')).toBeVisible()
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
    await loginAsFreshSupplier(page, 'product-images')
    await page.goto('/supplier/products/new')
    await fillRequiredFields(page, name)
    await page.locator('input[type="file"]').setInputFiles({
      name: 'kiosk.png',
      mimeType: 'image/png',
      buffer: await whiteBackdropPng(),
    })
    await page.getByRole('button', { name: 'Vytvořit produkt' }).click()
    await draftProductId(page)
    await stockPreselected(page, '2', '25')

    await loginAs(page, 'kiosk')
    await page.goto('/kiosk/shop?keypadId=89992')
    const image = page.getByRole('img', { name })
    await expect(image).toBeVisible()
    await expect(image).toHaveCSS('object-fit', 'contain')
  })
})

/** A fresh, valid Czech EAN-13 — barcodes are unique per product. */
function randomEan(): string {
  const body = `859${String(Date.now()).slice(-9)}`
  const sum = body
    .split('')
    .reverse()
    .reduce((acc, digit, index) => acc + Number(digit) * (index % 2 === 0 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

test.describe('Contributing to Open Food Facts', () => {
  test('is offered for a public EAN and says what goes, own photo included', async ({ page }) => {
    const name = `E2E OFF ${Date.now()}`
    const ean = randomEan()
    await loginAsFreshSupplier(page, 'product-images')
    await page.goto('/supplier/products/new')
    const contribution = page.getByTestId('product-off-contribution')

    await page.locator('#product-barcode').fill('2005702000004')
    await expect(contribution).toHaveCount(0)

    await page.locator('#product-barcode').fill(ean)
    await expect(contribution).toContainText('Pošle EAN a název')
    await expect(contribution.getByRole('checkbox')).not.toBeChecked()

    await fillRequiredFields(page, name)
    await page.locator('input[type="file"]').setInputFiles({
      name: 'own.png',
      mimeType: 'image/png',
      buffer: await whiteBackdropPng(),
    })
    await expect(page.getByTestId('product-image-status')).toHaveText('Hotovo: pozadí odstraněno')
    await expect(contribution).toContainText('Pošle EAN, název a vaši fotku')
    // The licence sentence sits behind the (i) next to it.
    await contribution.getByTestId('product-off-license').click()
    await expect(page.getByRole('dialog')).toContainText('CC BY-SA')
    await page.keyboard.press('Escape')

    await page.getByText('Přispět do Open Food Facts').click()
    await expect(contribution.getByRole('checkbox')).toBeChecked()

    await page.getByRole('button', { name: 'Vytvořit produkt' }).click()
    const productId = await draftProductId(page)
    await discardDraft(page)

    // Name and EAN went once; the edit form only offers a new own photo.
    await page.goto(`/supplier/products/${productId}/edit`)
    await page.locator('#edit-product-name').waitFor()
    await expect(contribution).toHaveCount(0)
    await page.locator('input[type="file"]').setInputFiles({
      name: 'another.png',
      mimeType: 'image/png',
      buffer: await whiteBackdropPng(70, 110),
    })
    await expect(contribution).toContainText('Pošle vaši novou fotku')
  })

  test('without an own photo it says a picture from elsewhere is not sent', async ({ page }) => {
    await loginAs(page, 'supplier')
    await page.goto('/supplier/products/new')
    await page.locator('#product-barcode').fill(randomEan())
    const contribution = page.getByTestId('product-off-contribution')
    await expect(contribution).toContainText('Obrázek z odkazu nebo z Open Food Facts se neposílá')
  })
})
