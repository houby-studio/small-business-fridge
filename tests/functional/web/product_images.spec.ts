import '#tests/test_context'
import { test } from '@japa/runner'
import sharp from 'sharp'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { ProductFactory } from '#database/factories/product_factory'
import Product from '#models/product'
import productImagesConfig from '#config/product_images'
import { normalizeCatalogImages } from '#services/product_images/catalog_normalizer'
import { productOnBackdrop, startStubServer } from '#tests/utils/product_image_fixtures'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('product_allergen').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('auth_access_tokens').delete()
  await db.from('users').delete()
}

function bodyBuffer(response: { response: { body: unknown } }): Buffer {
  return response.response.body as Buffer
}

test.group('Web Supplier - product image processing', (group) => {
  const originalOff = { ...productImagesConfig.openFoodFacts }
  const originalCloudflare = { ...productImagesConfig.cloudflare }
  group.each.setup(cleanAll)
  group.each.teardown(async () => {
    Object.assign(productImagesConfig.openFoodFacts, originalOff)
    Object.assign(productImagesConfig.cloudflare, originalCloudflare)
    await cleanAll()
  })

  test('turns an upload into a trimmed 450×800 WebP without a backdrop', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client
      .post('/supplier/products/image/process')
      .loginAs(supplier)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .file('image', await productOnBackdrop({ product: { width: 40, height: 70 } }), {
        filename: 'cola.png',
        contentType: 'image/png',
      })
      .field('background', 'auto')
      .field('rotate', 'auto')

    response.assertStatus(200)
    response.assertHeader('content-type', 'image/webp')
    response.assertHeader('x-image-background', 'flood')
    const meta = await sharp(bodyBuffer(response)).metadata()
    assert.equal(meta.format, 'webp')
    assert.equal(meta.width, 450)
    assert.equal(meta.height, 800)
  })

  test('customers cannot use the image pipeline', async ({ client }) => {
    const customer = await UserFactory.create()
    const response = await client
      .post('/supplier/products/image/process')
      .loginAs(customer)
      .withCsrfToken()
      .file('image', await productOnBackdrop({ product: { width: 10, height: 10 } }), {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .redirects(0)
    response.assertStatus(302)
  })

  test('requires a file or a link and validates the options', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const missing = await client
      .post('/supplier/products/image/process')
      .loginAs(supplier)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .field('background', 'auto')
    missing.assertStatus(422)

    const badOption = await client
      .post('/supplier/products/image/process')
      .loginAs(supplier)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .field('url', 'https://example.com/a.png')
      .field('background', 'photoshop')
    badOption.assertStatus(422)
  })

  test('says so when a method is not enabled on the server', async ({ client, assert }) => {
    productImagesConfig.cloudflare.url = ''
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client
      .post('/supplier/products/image/process')
      .loginAs(supplier)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .file('image', await productOnBackdrop({ product: { width: 10, height: 10 } }), {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .field('background', 'cloudflare')
    response.assertStatus(422)
    assert.equal(response.body().error, 'image_background_method_unavailable')
    assert.isString(response.body().message)
  })

  test('refuses to fetch a link into the internal network', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client
      .post('/supplier/products/image/process')
      .loginAs(supplier)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .field('url', 'http://127.0.0.1:3333/uploads/products/x.png')
    response.assertStatus(422)
    assert.equal(response.body().error, 'image_url_blocked')
  })

  test('rejects a file that only pretends to be an image', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client
      .post('/supplier/products/image/process')
      .loginAs(supplier)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .file('image', Buffer.from('definitely not a png'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
    response.assertStatus(422)
    // The validator sniffs the content, so a renamed file never reaches the pipeline.
    assert.equal(response.body().errors[0].field, 'image')
  })

  test('lists Open Food Facts candidates for a barcode', async ({ client, assert }) => {
    const off = await startStubServer((_req, _body, res) => {
      res
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(
          JSON.stringify({ status: 1, product: { product_name: 'Kofola', images: { '1': {} } } })
        )
    })
    productImagesConfig.openFoodFacts.baseUrl = off.url
    try {
      const supplier = await UserFactory.apply('supplier').create()
      const response = await client
        .get('/supplier/products/image/candidates?barcode=8593868001231')
        .loginAs(supplier)
        .header('Accept', 'application/json')
      response.assertStatus(200)
      assert.equal(response.body().productName, 'Kofola')
      assert.lengthOf(response.body().candidates, 1)

      const invalid = await client
        .get('/supplier/products/image/candidates?barcode=abc')
        .loginAs(supplier)
        .header('Accept', 'application/json')
      invalid.assertStatus(422)
    } finally {
      await off.close()
    }
  })

  test('the product forms receive the image capabilities', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    for (const url of ['/supplier/products/new', `/supplier/products/${product.id}/edit`]) {
      const response = await client
        .get(url)
        .loginAs(supplier)
        .header('X-Inertia', 'true')
        .header('X-Inertia-Version', '1')
      response.assertStatus(200)
      assert.includeMembers(response.body().props.imageCapabilities.backgrounds, [
        'auto',
        'none',
        'flood',
      ])
    }
  })
})

test.group('products:normalize-images', (group) => {
  const directory = app.makePath('storage/uploads/products')
  const written: string[] = []
  group.each.setup(cleanAll)
  group.each.teardown(async () => {
    await cleanAll()
    await Promise.all(written.splice(0).map((f) => rm(path.join(directory, f), { force: true })))
  })

  async function productWithImage(png: Buffer) {
    await mkdir(directory, { recursive: true })
    const fileName = `normalize-test-${Date.now()}-${Math.random().toString(36).slice(2)}.png`
    await writeFile(path.join(directory, fileName), png)
    written.push(fileName)
    const category = await CategoryFactory.create()
    return ProductFactory.merge({
      categoryId: category.id,
      imagePath: `/uploads/products/${fileName}`,
    }).create()
  }

  test('a dry run reports but changes nothing', async ({ assert }) => {
    const product = await productWithImage(
      await productOnBackdrop({ product: { width: 200, height: 40 } })
    )
    const report = await normalizeCatalogImages({ dryRun: true, background: 'none' })
    assert.equal(report.processed, 1)
    assert.equal(report.rotated, 1)
    await product.refresh()
    assert.match(product.imagePath!, /normalize-test-/)
  })

  test('rewrites the image, keeps the old file and audits the change', async ({ assert }) => {
    const product = await productWithImage(
      await productOnBackdrop({ product: { width: 200, height: 40 } })
    )
    const oldPath = product.imagePath!
    const report = await normalizeCatalogImages({ dryRun: false, background: 'flood' })
    assert.equal(report.processed, 1)

    const updated = await Product.findOrFail(product.id)
    assert.match(updated.imagePath!, /^\/uploads\/products\/[0-9a-f-]+\.webp$/)
    const newFile = path.basename(updated.imagePath!)
    written.push(newFile)
    const meta = await sharp(await readFile(path.join(directory, newFile))).metadata()
    assert.equal(meta.width, 450)
    assert.equal(meta.height, 800)
    await readFile(path.join(directory, path.basename(oldPath)))

    const audit = await db.from('audit_logs').where('action', 'product.updated').first()
    assert.equal(audit.entity_id, product.id)
    assert.isNull(audit.user_id)
  })

  test('skips products whose file is missing or that use a legacy path', async ({ assert }) => {
    const category = await CategoryFactory.create()
    await ProductFactory.merge({
      categoryId: category.id,
      imagePath: '/uploads/products/does-not-exist.png',
    }).create()
    await ProductFactory.merge({
      categoryId: category.id,
      imagePath: '/images/default-product.png',
    }).create()
    const report = await normalizeCatalogImages({ dryRun: false, background: 'none' })
    assert.equal(report.processed, 0)
    assert.equal(report.skipped, 2)
  })
})
