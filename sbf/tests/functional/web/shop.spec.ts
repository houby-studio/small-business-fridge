import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Order from '#models/order'
import User from '#models/user'
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
    if (response.status() !== 200) console.log(response.text())
    response.assertStatus(200)
    response.assertTextIncludes(product.displayName)
  })

  test('shop page loads when no products exist', async ({ client }) => {
    const user = await UserFactory.create()
    const response = await client.get('/shop').loginAs(user)
    response.assertStatus(200)
  })
})

test.group('Web Shop - category filter', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('category param returns all products (filtering is client-side only)', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const catA = await CategoryFactory.create()
    const catB = await CategoryFactory.create()
    const productA = await ProductFactory.merge({ categoryId: catA.id }).create()
    const productB = await ProductFactory.merge({ categoryId: catB.id }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: productA.id,
      amountLeft: 2,
      price: 10,
    }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: productB.id,
      amountLeft: 2,
      price: 10,
    }).create()

    // Server always returns all products; category filtering is done client-side
    const response = await client.get(`/shop?category=${catA.id}`).loginAs(user)
    response.assertStatus(200)
    response.assertTextIncludes(productA.displayName)
    assert.include(response.text(), productB.displayName)
  })

  test('no category filter returns all in-stock products', async ({ client, assert }) => {
    const user = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const catA = await CategoryFactory.create()
    const catB = await CategoryFactory.create()
    const productA = await ProductFactory.merge({ categoryId: catA.id }).create()
    const productB = await ProductFactory.merge({ categoryId: catB.id }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: productA.id,
      amountLeft: 2,
      price: 10,
    }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: productB.id,
      amountLeft: 2,
      price: 10,
    }).create()

    const response = await client.get('/shop').loginAs(user)
    response.assertStatus(200)
    response.assertTextIncludes(productA.displayName)
    response.assertTextIncludes(productB.displayName)
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

test.group('Web Shop - add_favorite', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('?add_favorite adds product to favorites and redirects to /shop', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()

    const response = await client.get(`/shop?add_favorite=${product.id}`).loginAs(user).redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/shop')

    const freshUser = await User.find(user.id)
    await freshUser!.load((loader) => loader.load('favoriteProducts'))
    assert.isTrue(freshUser!.favoriteProducts.some((p) => p.id === product.id))
  })

  test('?add_favorite when already a favorite does not duplicate and redirects', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()

    await db
      .table('user_favorites')
      .insert({ user_id: user.id, product_id: product.id, created_at: new Date() })

    const response = await client.get(`/shop?add_favorite=${product.id}`).loginAs(user).redirects(0)

    response.assertStatus(302)

    const count = await db.from('user_favorites').where('user_id', user.id).count('* as total')
    assert.equal(Number(count[0].total), 1)
  })

  test('?add_favorite with non-existent product redirects gracefully', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()

    const response = await client.get('/shop?add_favorite=999999').loginAs(user).redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/shop')
  })
})
