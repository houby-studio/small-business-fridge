import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { UserFactory } from '#database/factories/user_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { OrderFactory } from '#database/factories/order_factory'
import { InvoiceFactory } from '#database/factories/invoice_factory'
import { store as throttleStore } from '#middleware/throttle_middleware'

test.group('API Customers', (group) => {
  const cleanAll = async () => {
    throttleStore.clear()
    await db.from('audit_logs').delete()
    await db.from('orders').delete()
    await db.from('invoices').delete()
    await db.from('deliveries').delete()
    await db.from('product_allergen').delete()
    await db.from('products').delete()
    await db.from('allergens').delete()
    await db.from('categories').delete()
    await db.from('auth_access_tokens').delete()
    await db.from('users').delete()
  }

  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('show returns own customer profile for authenticated user', async ({ client, assert }) => {
    const customer = await UserFactory.merge({ displayName: 'Alice Customer' }).create()
    const token = await User.accessTokens.create(customer, ['*'])

    const response = await client
      .get(`/api/v1/customers/${customer.id}`)
      .header('Authorization', `Bearer ${token.value!.release()}`)

    response.assertStatus(200)
    assert.equal(response.body().data.id, customer.id)
    assert.equal(response.body().data.displayName, 'Alice Customer')
    assert.equal(response.body().data.role, 'customer')
  })

  test('show rejects access to another customer for non-admin user', async ({ client }) => {
    const actor = await UserFactory.create()
    const target = await UserFactory.create()
    const token = await User.accessTokens.create(actor, ['*'])

    const response = await client
      .get(`/api/v1/customers/${target.id}`)
      .header('Authorization', `Bearer ${token.value!.release()}`)

    response.assertStatus(403)
  })

  test('show allows admin to access another customer', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const target = await UserFactory.merge({ displayName: 'Bob Target' }).create()
    const token = await User.accessTokens.create(admin, ['*'])

    const response = await client
      .get(`/api/v1/customers/${target.id}`)
      .header('Authorization', `Bearer ${token.value!.release()}`)

    response.assertStatus(200)
    assert.equal(response.body().data.id, target.id)
    assert.equal(response.body().data.displayName, 'Bob Target')
  })

  test('insights returns aggregate stats for authorized customer', async ({ client, assert }) => {
    const customer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const token = await User.accessTokens.create(customer, ['*'])

    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      price: 15,
      amountLeft: 10,
    }).create()

    const invoice = await InvoiceFactory.merge({
      buyerId: customer.id,
      supplierId: supplier.id,
      totalCost: 15,
      isPaid: false,
      isPaymentRequested: true,
    }).create()

    await OrderFactory.merge({
      buyerId: customer.id,
      deliveryId: delivery.id,
      invoiceId: invoice.id,
    }).create()
    await OrderFactory.merge({
      buyerId: customer.id,
      deliveryId: delivery.id,
      invoiceId: null,
    }).create()

    const response = await client
      .get(`/api/v1/customers/${customer.id}/insights`)
      .header('Authorization', `Bearer ${token.value!.release()}`)

    response.assertStatus(200)
    assert.equal(response.body().data.orderCount, 2)
    assert.equal(response.body().data.totalSpend, 30)
    assert.equal(response.body().data.uninvoicedSpend, 15)
    assert.equal(response.body().data.invoiceCount, 1)
    assert.equal(response.body().data.pendingApprovalInvoiceCount, 1)
    assert.exists(response.body().data.lastOrderAt)
  })
})
