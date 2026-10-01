import '#tests/test_context'
import { test } from '@japa/runner'
import sharp from 'sharp'
import productImagesConfig from '#config/product_images'
import ProductImageService from '#services/product_images/product_image_service'
import { isDomainError } from '#services/domain_error'
import {
  alphaAt,
  noisyImage,
  productOnBackdrop,
  startStubServer,
  type StubServer,
} from '#tests/utils/product_image_fixtures'

/** Pretends to be a model: returns a cut-out (transparent backdrop) product. */
async function modelStub(status = 200): Promise<StubServer> {
  const cutOut = await productOnBackdrop({
    product: { width: 40, height: 60 },
    backdrop: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  return startStubServer((_req, _body, res) => {
    if (status !== 200) {
      res.writeHead(status).end('boom')
      return
    }
    res.writeHead(200, { 'Content-Type': 'image/png' }).end(cutOut)
  })
}

test.group('Product images - service', (group) => {
  const original = {
    rembg: { ...productImagesConfig.rembg },
    cloudflare: { ...productImagesConfig.cloudflare },
    autoChain: [...productImagesConfig.autoChain],
  }
  group.each.teardown(() => {
    Object.assign(productImagesConfig.rembg, original.rembg)
    Object.assign(productImagesConfig.cloudflare, original.cloudflare)
    productImagesConfig.autoChain = [...original.autoChain]
  })

  test('offers only configured providers', ({ assert }) => {
    productImagesConfig.rembg.url = ''
    productImagesConfig.cloudflare.url = ''
    assert.deepEqual(ProductImageService.capabilities().backgrounds, ['auto', 'none', 'flood'])
    productImagesConfig.rembg.url = 'http://rembg:7000'
    productImagesConfig.cloudflare.url = 'https://worker.example'
    assert.deepEqual(ProductImageService.capabilities().backgrounds, [
      'auto',
      'none',
      'flood',
      'rembg',
      'cloudflare',
    ])
  })

  test('auto without a model falls back to the flood fill', async ({ assert }) => {
    productImagesConfig.rembg.url = ''
    productImagesConfig.cloudflare.url = ''
    const result = await new ProductImageService().process(
      await productOnBackdrop({ product: { width: 40, height: 60 } }),
      { background: 'auto', rotate: 'auto' }
    )
    assert.equal(result.background, 'flood')
    const meta = await sharp(result.buffer).metadata()
    assert.equal(meta.width, 450)
    assert.equal(meta.height, 800)
  })

  test('auto keeps a photo as is when nothing can cut it out', async ({ assert }) => {
    productImagesConfig.rembg.url = ''
    productImagesConfig.cloudflare.url = ''
    const result = await new ProductImageService().process(await noisyImage(), {
      background: 'auto',
      rotate: 'none',
    })
    assert.equal(result.background, 'none')
    assert.equal(await alphaAt(result.buffer, 225, 400), 255)
  })

  test('a backdrop kept on a transparent canvas is still removed', async ({ assert }) => {
    productImagesConfig.rembg.url = ''
    productImagesConfig.cloudflare.url = ''
    const service = new ProductImageService()
    // Wide and tall variants: whether the canvas margins end up left/right or top/bottom
    // must not matter.
    for (const product of [
      { width: 40, height: 60 },
      { width: 40, height: 140 },
    ]) {
      const kept = await service.process(await productOnBackdrop({ product }), {
        background: 'none',
        rotate: 'none',
      })
      const auto = await service.process(kept.buffer, { background: 'auto', rotate: 'none' })
      assert.equal(auto.background, 'flood', JSON.stringify(product))
      assert.isNull(auto.note)
    }
  })

  test('auto leaves a cut-out product alone and says so', async ({ assert }) => {
    const circle = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">' +
          '<circle cx="100" cy="100" r="80" fill="#c81e28"/></svg>'
      )
    )
      .png()
      .toBuffer()
    const result = await new ProductImageService().process(circle, {
      background: 'auto',
      rotate: 'auto',
    })
    assert.equal(result.background, 'none')
    assert.equal(result.note, 'already_transparent')
  })

  test('sends the image to rembg with the configured model', async ({ assert }) => {
    const server = await modelStub()
    productImagesConfig.rembg.url = server.url
    productImagesConfig.rembg.model = 'birefnet-general-lite'
    try {
      const result = await new ProductImageService().process(await noisyImage(), {
        background: 'rembg',
        rotate: 'auto',
      })
      assert.equal(result.background, 'rembg')
      assert.equal(server.requests[0].url, '/api/remove')
      assert.include(server.requests[0].body.toString('latin1'), 'birefnet-general-lite')
      assert.equal(await alphaAt(result.buffer, 2, 2), 0)
    } finally {
      await server.close()
    }
  })

  test('sends the bearer token to the Cloudflare worker', async ({ assert }) => {
    const server = await modelStub()
    productImagesConfig.cloudflare.url = `${server.url}/remove`
    productImagesConfig.cloudflare.token = 'secret-token'
    try {
      const result = await new ProductImageService().process(await noisyImage(), {
        background: 'cloudflare',
        rotate: 'auto',
      })
      assert.equal(result.background, 'cloudflare')
      assert.equal(server.requests[0].headers.authorization, 'Bearer secret-token')
    } finally {
      await server.close()
    }
  })

  test('auto prefers a model and skips one that is down', async ({ assert }) => {
    const down = await modelStub(502)
    const up = await modelStub()
    productImagesConfig.cloudflare.url = down.url
    productImagesConfig.rembg.url = up.url
    productImagesConfig.autoChain = ['cloudflare', 'rembg', 'flood']
    try {
      const result = await new ProductImageService().process(await noisyImage(), {
        background: 'auto',
        rotate: 'auto',
      })
      assert.equal(result.background, 'rembg')
      assert.lengthOf(down.requests, 1)
    } finally {
      await down.close()
      await up.close()
    }
  })

  test('reports a failing provider instead of hiding it', async ({ assert }) => {
    const down = await modelStub(500)
    productImagesConfig.rembg.url = down.url
    try {
      await new ProductImageService().process(await noisyImage(), {
        background: 'rembg',
        rotate: 'auto',
      })
      assert.fail('expected an error')
    } catch (error) {
      assert.isTrue(isDomainError(error, 'image_background_provider_failed'))
    } finally {
      await down.close()
    }
  })

  test('rejects an unconfigured method and a non-image file', async ({ assert }) => {
    productImagesConfig.cloudflare.url = ''
    const service = new ProductImageService()
    try {
      await service.process(await noisyImage(), { background: 'cloudflare', rotate: 'auto' })
      assert.fail('expected an error')
    } catch (error) {
      assert.isTrue(isDomainError(error, 'image_background_method_unavailable'))
    }
    try {
      await service.process(Buffer.from('%PDF-1.4 not an image'), {
        background: 'none',
        rotate: 'auto',
      })
      assert.fail('expected an error')
    } catch (error) {
      assert.isTrue(isDomainError(error, 'image_unreadable'))
    }
  })
})
