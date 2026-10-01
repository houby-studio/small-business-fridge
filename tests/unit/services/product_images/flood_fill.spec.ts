import '#tests/test_context'
import { test } from '@japa/runner'
import sharp from 'sharp'
import { hasTransparentBorder, removeUniformBackground } from '#services/product_images/flood_fill'
import { decodeToRaw } from '#services/product_images/normalize'
import { noisyImage, productOnBackdrop } from '#tests/utils/product_image_fixtures'

test.group('Product images - flood fill', () => {
  test('clears a white backdrop and keeps the product', async ({ assert }) => {
    const raw = await decodeToRaw(await productOnBackdrop({ product: { width: 40, height: 60 } }))
    const result = removeUniformBackground(raw)
    assert.isNotNull(result)
    const alpha = (x: number, y: number) => result!.data[(y * result!.width + x) * 4 + 3]
    assert.equal(alpha(0, 0), 0)
    assert.equal(alpha(5, 50), 0)
    assert.equal(alpha(40, 50), 255)
  })

  test('works on a JPEG backdrop that is only nearly uniform', async ({ assert }) => {
    const jpeg = await productOnBackdrop({ product: { width: 40, height: 60 }, format: 'jpeg' })
    const result = removeUniformBackground(await decodeToRaw(jpeg))
    assert.isNotNull(result)
    assert.equal(result!.data[3], 0)
  })

  test('works on a coloured plain backdrop too', async ({ assert }) => {
    const raw = await decodeToRaw(
      await productOnBackdrop({
        product: { width: 30, height: 30 },
        backdrop: { r: 20, g: 120, b: 220 },
        color: { r: 250, g: 250, b: 250 },
      })
    )
    assert.isNotNull(removeUniformBackground(raw))
  })

  test('refuses a busy border (a photo)', async ({ assert }) => {
    assert.isNull(removeUniformBackground(await decodeToRaw(await noisyImage())))
  })

  test('refuses an image that is all backdrop', async ({ assert }) => {
    const blank = await sharp({
      create: { width: 50, height: 50, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer()
    assert.isNull(removeUniformBackground(await decodeToRaw(blank)))
  })

  test('refuses an image that is already cut out', async ({ assert }) => {
    const raw = await decodeToRaw(
      await productOnBackdrop({
        product: { width: 30, height: 30 },
        backdrop: { r: 0, g: 0, b: 0, alpha: 0 },
      })
    )
    assert.isTrue(hasTransparentBorder(raw))
    assert.isNull(removeUniformBackground(raw))
  })
})
