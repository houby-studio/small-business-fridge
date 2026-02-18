import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { store as throttleStore } from '#middleware/throttle_middleware'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'

test.group('API Products', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await db.from('user_favorites').delete()
    await db.from('orders').delete()
    await db.from('deliveries').delete()
    await db.from('products').delete()
    await db.from('categories').delete()
    await db.from('auth_access_tokens').delete()
    await db.from('users').delete()
  })

  test('unauthenticated request returns 401', async ({ client }) => {
    const response = await client.get('/api/v1/products')
    response.assertStatus(401)
  })

  test('authenticated request returns products', async ({ client, assert }) => {
    const user = await UserFactory.create()
    const token = await User.accessTokens.create(user, ['*'])

    const category = await CategoryFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const product = await ProductFactory.merge({
      categoryId: category.id,
      barcode: 'ABC123',
    }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 5,
      price: 15,
    }).create()

    const response = await client
      .get('/api/v1/products')
      .header('Authorization', `Bearer ${token.value!.release()}`)

    response.assertStatus(200)
    assert.isArray(response.body().data)
    assert.lengthOf(response.body().data, 1)
    assert.equal(response.body().data[0].displayName, product.displayName)
    assert.equal(response.body().data[0].price, 15)
  })

  test('get product by barcode', async ({ client, assert }) => {
    const user = await UserFactory.create()
    const token = await User.accessTokens.create(user, ['*'])

    const category = await CategoryFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const product = await ProductFactory.merge({
      categoryId: category.id,
      barcode: 'SCAN001',
    }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 3,
      price: 10,
    }).create()

    const response = await client
      .get('/api/v1/products/SCAN001')
      .header('Authorization', `Bearer ${token.value!.release()}`)

    response.assertStatus(200)
    assert.equal(response.body().data.barcode, 'SCAN001')
    assert.equal(response.body().data.stockSum, 3)
  })

  test('non-existent barcode returns 404', async ({ client }) => {
    const user = await UserFactory.create()
    const token = await User.accessTokens.create(user, ['*'])

    const response = await client
      .get('/api/v1/products/NONEXISTENT')
      .header('Authorization', `Bearer ${token.value!.release()}`)

    response.assertStatus(404)
  })
})
