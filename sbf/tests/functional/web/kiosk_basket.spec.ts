import '#tests/test_context'
import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Allergen from '#models/allergen'
import Order from '#models/order'
import db from '@adonisjs/lucid/services/db'

const cleanAll = async () => {
  await db.from('recommendations').delete()
  await db.from('kiosk_sessions').delete()
  await db.from('orders').delete()
  await db.from('deliveries').delete()
  await db.from('product_allergen').delete()
  await db.from('products').delete()
  await db.from('allergens').delete()
  await db.from('categories').delete()
  await db.from('auth_access_tokens').delete()
  await db.from('users').delete()
}

test.group('POST /kiosk/purchase-basket', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('purchases all basket items atomically and returns ok', async ({ client, assert }) => {
    const kioskDevice = await UserFactory.apply('kiosk').create()
    const customer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product1 = await ProductFactory.merge({ categoryId: category.id }).create()
    const product2 = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery1 = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product1.id,
      amountLeft: 5,
      price: 15,
    }).create()
    const delivery2 = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product2.id,
      amountLeft: 3,
      price: 10,
    }).create()

    const response = await client
      .post('/kiosk/purchase-basket')
      .json({
        customerId: customer.id,
        items: [
          { deliveryId: delivery1.id, quantity: 2 },
          { deliveryId: delivery2.id, quantity: 1 },
        ],
      })
      .loginAs(kioskDevice)
      .withCsrfToken()

    response.assertStatus(200)
    const body = JSON.parse(response.text())
    assert.isTrue(body.ok)
    assert.equal(body.orderCount, 3)

    // 3 order rows created (2 + 1)
    const count = await Order.query().where('buyerId', customer.id).count('* as total')
    assert.equal(Number(count[0].$extras.total), 3)
  })

  test('returns out_of_stock and rolls back when a delivery has insufficient stock', async ({
    client,
    assert,
  }) => {
    const kioskDevice = await UserFactory.apply('kiosk').create()
    const customer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product1 = await ProductFactory.merge({ categoryId: category.id }).create()
    const product2 = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery1 = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product1.id,
      amountLeft: 5,
      price: 15,
    }).create()
    const delivery2 = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product2.id,
      amountLeft: 1, // only 1 left, but we request 3
      price: 10,
    }).create()

    const response = await client
      .post('/kiosk/purchase-basket')
      .json({
        customerId: customer.id,
        items: [
          { deliveryId: delivery1.id, quantity: 1 },
          { deliveryId: delivery2.id, quantity: 3 },
        ],
      })
      .loginAs(kioskDevice)
      .withCsrfToken()

    response.assertStatus(200)
    const body = JSON.parse(response.text())
    assert.isFalse(body.ok)
    assert.equal(body.error, 'out_of_stock')
    assert.equal(body.deliveryId, delivery2.id)

    // No orders created (transaction rolled back)
    const count = await Order.query().where('buyerId', customer.id).count('* as total')
    assert.equal(Number(count[0].$extras.total), 0)
  })
})

test.group('GET /kiosk/customer', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('returns customer + favoriteIds + recommendedIds for valid keypadId', async ({
    client,
    assert,
  }) => {
    const kioskDevice = await UserFactory.apply('kiosk').create()
    const customer = await UserFactory.create()

    const response = await client
      .get(`/kiosk/customer?keypadId=${customer.keypadId}`)
      .loginAs(kioskDevice)

    response.assertStatus(200)
    const body = JSON.parse(response.text())
    assert.equal(body.customer.id, customer.id)
    assert.isArray(body.favoriteIds)
    assert.isArray(body.recommendedIds)
    assert.isArray(body.excludedAllergenIds)
  })

  test('returns 404 for unknown keypadId', async ({ client, assert }) => {
    const kioskDevice = await UserFactory.apply('kiosk').create()

    const response = await client.get('/kiosk/customer?keypadId=999999').loginAs(kioskDevice)

    response.assertStatus(404)
    assert.include(response.text(), 'error')
  })

  test('recommendedIds skip out-of-stock higher ranks and backfill with lower in-stock ranks', async ({
    client,
    assert,
  }) => {
    const kioskDevice = await UserFactory.apply('kiosk').create()
    const customer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()

    const productRank1 = await ProductFactory.merge({ categoryId: category.id }).create()
    const productRank2 = await ProductFactory.merge({ categoryId: category.id }).create()
    const productRank3 = await ProductFactory.merge({ categoryId: category.id }).create()

    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: productRank1.id,
      amountLeft: 0,
      amountSupplied: 5,
      price: 10,
    }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: productRank2.id,
      amountLeft: 5,
      price: 10,
    }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: productRank3.id,
      amountLeft: 5,
      price: 10,
    }).create()

    const now = new Date()
    await db.table('recommendations').insert([
      {
        user_id: customer.id,
        product_id: productRank1.id,
        score: 0.9,
        model: 'statistical',
        rank: 1,
        generated_at: now,
        created_at: now,
      },
      {
        user_id: customer.id,
        product_id: productRank2.id,
        score: 0.8,
        model: 'statistical',
        rank: 2,
        generated_at: now,
        created_at: now,
      },
      {
        user_id: customer.id,
        product_id: productRank3.id,
        score: 0.7,
        model: 'statistical',
        rank: 3,
        generated_at: now,
        created_at: now,
      },
    ])

    const response = await client
      .get(`/kiosk/customer?keypadId=${customer.keypadId}`)
      .loginAs(kioskDevice)

    response.assertStatus(200)
    const body = JSON.parse(response.text())
    assert.deepEqual(body.recommendedIds, [productRank2.id, productRank3.id])
    assert.notInclude(body.recommendedIds, productRank1.id)
  })

  test('recommendedIds skip products matching customer excluded allergens', async ({
    client,
    assert,
  }) => {
    const kioskDevice = await UserFactory.apply('kiosk').create()
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const blockedAllergen = await Allergen.create({ name: 'Peanuts', isDisabled: false })

    const blockedProduct = await ProductFactory.merge({ categoryId: category.id }).create()
    const allowedProduct = await ProductFactory.merge({ categoryId: category.id }).create()

    await db.table('product_allergen').insert({
      product_id: blockedProduct.id,
      allergen_id: blockedAllergen.id,
    })

    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: blockedProduct.id,
      amountLeft: 4,
      price: 10,
    }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: allowedProduct.id,
      amountLeft: 4,
      price: 10,
    }).create()

    const customer = await UserFactory.merge({
      excludedAllergenIds: [blockedAllergen.id],
    }).create()

    const now = new Date()
    await db.table('recommendations').insert([
      {
        user_id: customer.id,
        product_id: blockedProduct.id,
        score: 0.9,
        model: 'statistical',
        rank: 1,
        generated_at: now,
        created_at: now,
      },
      {
        user_id: customer.id,
        product_id: allowedProduct.id,
        score: 0.8,
        model: 'statistical',
        rank: 2,
        generated_at: now,
        created_at: now,
      },
    ])

    const response = await client
      .get(`/kiosk/customer?keypadId=${customer.keypadId}`)
      .loginAs(kioskDevice)

    response.assertStatus(200)
    const body = JSON.parse(response.text())
    assert.deepEqual(body.recommendedIds, [allowedProduct.id])
    assert.deepEqual(body.excludedAllergenIds, [blockedAllergen.id])
    assert.notInclude(body.recommendedIds, blockedProduct.id)
  })
})
