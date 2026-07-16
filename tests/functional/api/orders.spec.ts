import '#tests/test_context'
import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { store as throttleStore } from '#middleware/throttle_middleware'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'

test.group('API Orders', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await db.from('user_favorites').delete()
    await db.from('orders').delete()
    await db.from('deliveries').delete()
    await db.from('product_allergen').delete()
    await db.from('products').delete()
    await db.from('allergens').delete()
    await db.from('categories').delete()
    await db.from('auth_access_tokens').delete()
    await db.from('users').delete()
  })

  async function createStockedDelivery() {
    const category = await CategoryFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 5,
      price: 15,
    }).create()
    return { category, supplier, product, delivery }
  }

  test('unauthenticated request returns 401', async ({ client }) => {
    const response = await client.post('/api/v1/orders').json({ deliveryId: 1, channel: 'kiosk' })
    response.assertStatus(401)
  })

  test('store purchases a delivery and returns the serialized order', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()
    const token = await User.accessTokens.create(user, ['*'])
    const { delivery } = await createStockedDelivery()

    const response = await client
      .post('/api/v1/orders')
      .header('Authorization', `Bearer ${token.value!.release()}`)
      .json({ deliveryId: delivery.id, channel: 'kiosk' })

    response.assertStatus(201)
    const order = response.body().data
    assert.equal(order.buyerId, user.id)
    assert.equal(order.deliveryId, delivery.id)
    assert.equal(order.channel, 'kiosk')
    assert.isNull(order.invoiceId)
    assert.isString(order.createdAt)
  })

  test('store returns 409 when the delivery is out of stock', async ({ client }) => {
    const user = await UserFactory.create()
    const token = await User.accessTokens.create(user, ['*'])
    const { supplier, product } = await createStockedDelivery()
    const emptyDelivery = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 0,
      price: 15,
    }).create()

    const response = await client
      .post('/api/v1/orders')
      .header('Authorization', `Bearer ${token.value!.release()}`)
      .json({ deliveryId: emptyDelivery.id, channel: 'scanner' })

    response.assertStatus(409)
  })

  test('latest returns recent orders with pagination meta and delivery detail', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()
    const token = await User.accessTokens.create(user, ['*'])
    const { product, supplier, delivery } = await createStockedDelivery()

    const purchase = await client
      .post('/api/v1/orders')
      .header('Authorization', `Bearer ${token.value!.release()}`)
      .json({ deliveryId: delivery.id, channel: 'kiosk' })
    purchase.assertStatus(201)

    const response = await client
      .get('/api/v1/orders/latest')
      .header('Authorization', `Bearer ${token.value!.release()}`)

    response.assertStatus(200)
    const page = response.body().data
    assert.deepInclude(page.meta, { total: 1, currentPage: 1 })
    assert.lengthOf(page.data, 1)

    const order = page.data[0]
    assert.equal(order.buyerId, user.id)
    assert.equal(order.delivery.id, delivery.id)
    assert.equal(order.delivery.price, 15)
    assert.equal(order.delivery.product.displayName, product.displayName)
    assert.equal(order.delivery.supplier.displayName, supplier.displayName)
  })
})
