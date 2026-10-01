import '#tests/test_context'
import { test } from '@japa/runner'
import sharp from 'sharp'
import {
  contentBox,
  cropToContent,
  decideRotation,
  decodeToRaw,
  normalizeProductImage,
  type NormalizeOptions,
} from '#services/product_images/normalize'
import { alphaAt, productOnBackdrop } from '#tests/utils/product_image_fixtures'

const options: NormalizeOptions = {
  width: 450,
  height: 800,
  rotate: 'auto',
  rotateMinRatio: 1.8,
  autoDirection: 'ccw',
}

const transparent = { r: 0, g: 0, b: 0, alpha: 0 }

test.group('Product images - normalize', () => {
  test('always produces a 450×800 WebP', async ({ assert }) => {
    const raw = await decodeToRaw(await productOnBackdrop({ product: { width: 30, height: 40 } }))
    const { buffer } = await normalizeProductImage(raw, options)
    const meta = await sharp(buffer).metadata()
    assert.equal(meta.format, 'webp')
    assert.equal(meta.width, 450)
    assert.equal(meta.height, 800)
    assert.isTrue(meta.hasAlpha)
  })

  test('trims transparent padding so the product fills the canvas', async ({ assert }) => {
    // 90×160 product (exactly 9:16) with a wide transparent margin: once trimmed it
    // must touch all four edges of the 450×800 canvas.
    const raw = await decodeToRaw(
      await productOnBackdrop({
        product: { width: 90, height: 160 },
        margin: 100,
        backdrop: transparent,
      })
    )
    assert.deepEqual(contentBox(raw), { left: 100, top: 100, width: 90, height: 160 })
    const { buffer } = await normalizeProductImage(raw, options)
    assert.isAbove(await alphaAt(buffer, 2, 2), 200)
    assert.isAbove(await alphaAt(buffer, 447, 797), 200)
  })

  test('crops to the visible content', async ({ assert }) => {
    const raw = await decodeToRaw(
      await productOnBackdrop({
        product: { width: 30, height: 50 },
        margin: 10,
        backdrop: transparent,
      })
    )
    const cropped = cropToContent(raw)
    assert.equal(cropped.width, 30)
    assert.equal(cropped.height, 50)
    assert.equal(cropped.data[3], 255)
    const opaque = await decodeToRaw(
      await productOnBackdrop({ product: { width: 10, height: 10 } })
    )
    assert.strictEqual(cropToContent(opaque), opaque)
  })

  test('turns a wide bar upright, counter-clockwise by default', async ({ assert }) => {
    const raw = await decodeToRaw(
      await productOnBackdrop({ product: { width: 200, height: 50 }, backdrop: transparent })
    )
    const result = await normalizeProductImage(raw, options)
    assert.equal(result.rotated, 'ccw')
    // Upright, the bar is 50 wide and 200 tall: scaled to 800 tall it spans 200px of
    // width, so the canvas centre is opaque and the far left edge is not.
    assert.isAbove(await alphaAt(result.buffer, 225, 400), 200)
    assert.equal(await alphaAt(result.buffer, 5, 400), 0)
  })

  test('leaves squat products (cups, round cheese) alone', ({ assert }) => {
    assert.isNull(decideRotation(150, 100, options))
    assert.equal(decideRotation(180, 100, options), 'ccw')
  })

  test('honours an explicit rotate choice', ({ assert }) => {
    assert.isNull(decideRotation(400, 50, { ...options, rotate: 'none' }))
    assert.equal(decideRotation(50, 400, { ...options, rotate: 'cw' }), 'cw')
    assert.equal(decideRotation(50, 400, { ...options, rotate: 'ccw' }), 'ccw')
  })

  test('shrinks a huge photo to the working resolution right after decoding', async ({
    assert,
  }) => {
    const huge = await sharp({
      create: { width: 6000, height: 4000, channels: 3, background: '#336699' },
    })
      .jpeg()
      .toBuffer()
    const raw = await decodeToRaw(huge)
    assert.equal(raw.width, 2048)
    assert.equal(raw.height, 1365)
  })

  test('enlarges a small source to the canvas', async ({ assert }) => {
    const raw = await decodeToRaw(
      await productOnBackdrop({ product: { width: 9, height: 16 }, margin: 0 })
    )
    const { buffer } = await normalizeProductImage(raw, options)
    assert.isAbove(await alphaAt(buffer, 225, 5), 200)
  })
})
