import '#tests/test_context'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { ProductFactory } from '#database/factories/product_factory'
import OffContribution from '#models/off_contribution'
import productImagesConfig from '#config/product_images'
import { productOnBackdrop } from '#tests/utils/product_image_fixtures'

const EAN = '8593868002030'

const cleanAll = async () => {
  await db.from('off_contributions').delete()
  await db.from('audit_logs').delete()
  await db.from('product_allergen').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('users').delete()
}

test.group('Web Supplier - contributing to Open Food Facts', (group) => {
  const originalOff = { ...productImagesConfig.openFoodFacts }
  group.each.setup(async () => {
    await cleanAll()
    // Nothing is sent from a request — the scheduler does that — so no OFF stub is needed.
    Object.assign(productImagesConfig.openFoodFacts, { userId: 'fridgora', password: 'x' })
  })
  group.each.teardown(async () => {
    Object.assign(productImagesConfig.openFoodFacts, originalOff)
    await cleanAll()
  })

  async function createProduct(
    supplier: Awaited<ReturnType<typeof UserFactory.create>>,
    fields: Record<string, string>,
    withOriginal: boolean,
    client: ApiClient
  ) {
    const category = await CategoryFactory.create()
    let request = client
      .post('/supplier/products')
      .loginAs(supplier)
      .withCsrfToken()
      .field('displayName', 'Kofola Original 0,5 l')
      .field('description', 'Bublinky')
      .field('categoryId', category.id)
      .field('barcode', fields.barcode ?? EAN)
      .field('allergenIds', JSON.stringify([]))
      .file('image', await productOnBackdrop({ product: { width: 20, height: 40 } }), {
        filename: 'product.webp',
        contentType: 'image/png',
      })
    for (const [key, value] of Object.entries(fields)) {
      if (key !== 'barcode') request = request.field(key, value)
    }
    if (withOriginal) {
      request = request.file(
        'offOriginal',
        await productOnBackdrop({ product: { width: 30, height: 60 }, format: 'jpeg' }),
        { filename: 'IMG_0001.jpg', contentType: 'image/jpeg' }
      )
    }
    return request.redirects(0)
  }

  test('saving with consent queues the EAN, name and the original photo', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await createProduct(
      supplier,
      { offContribute: '1', offBackground: 'flood' },
      true,
      client
    )
    response.assertStatus(302)

    const contribution = await OffContribution.query().firstOrFail()
    assert.equal(contribution.barcode, EAN)
    assert.equal(contribution.productName, 'Kofola Original 0,5 l')
    assert.equal(contribution.userId, supplier.id)
    assert.equal(contribution.background, 'flood')
    assert.equal(contribution.originalMime, 'image/jpeg')
    assert.isAbove(contribution.originalImage!.length, 100)
    assert.equal(contribution.status, 'pending')

    const audit = await db.from('audit_logs').where('action', 'product.off_shared').firstOrFail()
    assert.equal(audit.user_id, supplier.id)
    assert.isTrue(audit.metadata.photo)
  })

  test('without consent nothing is queued, even with a photo', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await createProduct(supplier, { offContribute: '0' }, true, client)
    response.assertStatus(302)
    assert.lengthOf(await OffContribution.all(), 0)
  })

  test('consent for an in-store code queues nothing and still saves', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await createProduct(
      supplier,
      { offContribute: '1', barcode: '2005702000004' },
      false,
      client
    )
    response.assertStatus(302)
    assert.match(response.header('location') ?? '', /^\/supplier\/stock\?preselect=\d+$/)
    assert.lengthOf(await OffContribution.all(), 0)
  })

  test('the forms offer it only with an instance OFF account', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const page = async () => {
      const response = await client
        .get('/supplier/products/new')
        .header('x-inertia', 'true')
        .header('x-inertia-version', '1')
        .loginAs(supplier)
      return response.body().props.imageCapabilities.openFoodFactsContribute
    }

    assert.isTrue(await page())
    productImagesConfig.openFoodFacts.userId = ''
    assert.isFalse(await page())
  })

  test('the edit form knows the barcode was shared already', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const product = await ProductFactory.with('category').merge({ barcode: EAN }).create()
    const offShared = async () => {
      const response = await client
        .get(`/supplier/products/${product.id}/edit`)
        .header('x-inertia', 'true')
        .header('x-inertia-version', '1')
        .loginAs(supplier)
      return response.body().props.product.offShared
    }

    assert.isFalse(await offShared())

    const response = await client
      .put(`/supplier/products/${product.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .field('displayName', product.displayName)
      .field('description', 'Popis')
      .field('categoryId', product.categoryId)
      .field('barcode', EAN)
      .field('allergenIds', JSON.stringify([]))
      .field('offContribute', '1')
      .redirects(0)
    response.assertStatus(302)

    const contribution = await OffContribution.query().firstOrFail()
    assert.isNull(contribution.originalImage)
    assert.isTrue(await offShared())
  })
})
