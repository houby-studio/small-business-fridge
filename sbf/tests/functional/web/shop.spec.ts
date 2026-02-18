import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Order from '#models/order'
import db from '@adonisjs/lucid/services/db'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('user_favorites').delete()
  await db.from('orders').delete()
  await db.from('invoices').delete()
  await db.from('deliveries').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('auth_access_tokens').delete()
  await db.from('users').delete()
}

test.group('Web Shop - index', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('renders shop page for authenticated user', async ({ client }) => {
    const user = await UserFactory.create()
    const response = await client.get('/shop').loginAs(user)
    response.assertStatus(200)
  })

  test('redirects unauthenticated user to login', async ({ client }) => {
    const response = await client.get('/shop').redirects(0)
    response.assertStatus(302)
  })

  test('shop page contains products from active categories', async ({ client }) => {
    const user = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 5,
      price: 20,
    }).create()

    const response = await client.get('/shop').loginAs(user)
    response.assertStatus(200)
    response.assertTextIncludes(product.displayName)
  })

  test('shop page loads when no products exist', async ({ client }) => {
    const user = await UserFactory.create()
    const response = await client.get('/shop').loginAs(user)
    response.assertStatus(200)
  })
})

test.group('Web Shop - purchase', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('successful purchase redirects to /shop and decrements stock', async ({
    client,
    assert,
  }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 5,
      price: 25,
    }).create()

    const response = await client
      .post('/shop/purchase')
      .loginAs(buyer)
      .withCsrfToken()
      .json({ deliveryId: delivery.id })
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/shop')

    // Verify stock was decremented
    await delivery.refresh()
    assert.equal(delivery.amountLeft, 4)

    // Verify order was created
    const order = await Order.query().where('buyerId', buyer.id).first()
    assert.isNotNull(order)
    assert.equal(order!.deliveryId, delivery.id)
    assert.equal(order!.channel, 'web')
  })

  test('purchase out-of-stock delivery redirects to /shop with no order created', async ({
    client,
    assert,
  }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.apply('depleted')
      .merge({ supplierId: supplier.id, productId: product.id })
      .create()

    const response = await client
      .post('/shop/purchase')
      .loginAs(buyer)
      .withCsrfToken()
      .json({ deliveryId: delivery.id })
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/shop')

    // No order should have been created
    const orderCount = await Order.query().where('buyerId', buyer.id).count('* as total')
    assert.equal(Number(orderCount[0].$extras.total), 0)
  })

  test('purchase requires authentication', async ({ client }) => {
    const response = await client.post('/shop/purchase').json({ deliveryId: 1 }).redirects(0)

    response.assertStatus(302)
  })

  test('purchase with invalid deliveryId redirects with error (web validation)', async ({
    client,
    assert,
  }) => {
    const buyer = await UserFactory.create()

    const response = await client
      .post('/shop/purchase')
      .loginAs(buyer)
      .withCsrfToken()
      .json({ deliveryId: -1 })
      .redirects(0)

    // Web route: validation errors result in redirect, not 422
    assert.notEqual(response.status(), 200)
  })

  test('multiple purchases correctly track orders per buyer', async ({ client, assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 10,
      amountSupplied: 10,
      price: 15,
    }).create()

    await client
      .post('/shop/purchase')
      .loginAs(buyer)
      .withCsrfToken()
      .json({ deliveryId: delivery.id })
      .redirects(0)
    await client
      .post('/shop/purchase')
      .loginAs(buyer)
      .withCsrfToken()
      .json({ deliveryId: delivery.id })
      .redirects(0)
    await client
      .post('/shop/purchase')
      .loginAs(buyer)
      .withCsrfToken()
      .json({ deliveryId: delivery.id })
      .redirects(0)

    await delivery.refresh()
    assert.equal(delivery.amountLeft, 7)

    const orderCount = await Order.query().where('buyerId', buyer.id).count('* as total')
    assert.equal(Number(orderCount[0].$extras.total), 3)
  })
})
