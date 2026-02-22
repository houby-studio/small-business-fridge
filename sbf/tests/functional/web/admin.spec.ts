import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import { InvoiceFactory } from '#database/factories/invoice_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { OrderFactory } from '#database/factories/order_factory'
import Invoice from '#models/invoice'
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

test.group('Admin - users search and filter', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('admin can view users page', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const response = await client.get('/admin/users').loginAs(admin)
    response.assertStatus(200)
  })

  test('customer cannot access admin users page', async ({ client }) => {
    const customer = await UserFactory.create()
    const response = await client.get('/admin/users').loginAs(customer).redirects(0)
    response.assertStatus(302)
  })

  test('search by name returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    await UserFactory.create()

    const response = await client.get('/admin/users?search=test').loginAs(admin)
    response.assertStatus(200)
  })

  test('filter by role returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    await UserFactory.apply('supplier').create()

    const response = await client.get('/admin/users?role=supplier').loginAs(admin)
    response.assertStatus(200)
  })

  test('search and role filter combined returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()

    const response = await client.get('/admin/users?search=john&role=customer').loginAs(admin)
    response.assertStatus(200)
  })
})

test.group('Admin - orders filter', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('admin can view orders page', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const response = await client.get('/admin/orders').loginAs(admin)
    response.assertStatus(200)
  })

  test('filter by channel=web returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: admin.id,
      productId: product.id,
      amountLeft: 5,
      price: 20,
    }).create()
    await OrderFactory.merge({
      buyerId: buyer.id,
      deliveryId: delivery.id,
      channel: 'web',
    }).create()

    const response = await client.get('/admin/orders?channel=web').loginAs(admin)
    response.assertStatus(200)
  })

  test('filter by invoiced=no returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: admin.id,
      productId: product.id,
      amountLeft: 5,
      price: 20,
    }).create()
    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()

    const response = await client.get('/admin/orders?invoiced=no').loginAs(admin)
    response.assertStatus(200)
  })

  test('search by buyer name returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()

    const response = await client.get('/admin/orders?search=alice').loginAs(admin)
    response.assertStatus(200)
  })
})

test.group('Admin - invoices filter', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('admin can view invoices page', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const response = await client.get('/admin/invoices').loginAs(admin)
    response.assertStatus(200)
  })

  test('filter by status=paid returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    await InvoiceFactory.apply('paid')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client.get('/admin/invoices?status=paid').loginAs(admin)
    response.assertStatus(200)
  })

  test('filter by status=unpaid returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()

    const response = await client.get('/admin/invoices?status=unpaid').loginAs(admin)
    response.assertStatus(200)
  })

  test('filter by status=awaiting returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()

    const response = await client.get('/admin/invoices?status=awaiting').loginAs(admin)
    response.assertStatus(200)
  })
})

test.group('Admin - generate invoice for user', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('admin can generate invoices for a user across all suppliers', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 5,
      price: 15,
    }).create()

    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()

    const response = await client
      .post(`/admin/users/${buyer.id}/generate-invoice`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/admin/users')

    const invoices = await Invoice.query().where('buyerId', buyer.id)
    assert.lengthOf(invoices, 1)
    assert.equal(invoices[0].totalCost, 15)
  })

  test('disable user with uninvoiced orders is blocked', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: admin.id,
      productId: product.id,
      amountLeft: 5,
      price: 10,
    }).create()

    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()

    const response = await client
      .put(`/admin/users/${buyer.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .form({ isDisabled: 'true' })
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/admin/users')

    // User must not be disabled
    await buyer.refresh()
    assert.isFalse(buyer.isDisabled)
  })

  test('disable user with unpaid invoices is blocked', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()

    await InvoiceFactory.merge({ buyerId: buyer.id, supplierId: supplier.id }).create()

    const response = await client
      .put(`/admin/users/${buyer.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .form({ isDisabled: 'true' })
      .redirects(0)

    response.assertStatus(302)

    await buyer.refresh()
    assert.isFalse(buyer.isDisabled)
  })

  test('disable user with no pending items succeeds', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()

    const response = await client
      .put(`/admin/users/${buyer.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .form({ isDisabled: 'true' })
      .redirects(0)

    response.assertStatus(302)

    await buyer.refresh()
    assert.isTrue(buyer.isDisabled)
  })
})
