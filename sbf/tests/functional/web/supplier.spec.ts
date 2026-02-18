import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { InvoiceFactory } from '#database/factories/invoice_factory'
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

test.group('Web Supplier - invoice index and generate', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('supplier can view invoice page', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client.get('/supplier/invoice').loginAs(supplier)
    response.assertStatus(200)
  })

  test('customer cannot access supplier invoice page', async ({ client }) => {
    const customer = await UserFactory.create()
    const response = await client.get('/supplier/invoice').loginAs(customer).redirects(0)
    response.assertStatus(302)
  })

  test('generate creates invoices for uninvoiced orders', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 5,
      price: 30,
    }).create()

    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()
    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()

    const response = await client
      .post('/supplier/invoice/generate')
      .loginAs(supplier)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/supplier/invoice')

    const invoice = await Invoice.query()
      .where('supplierId', supplier.id)
      .where('buyerId', buyer.id)
      .first()

    assert.isNotNull(invoice)
    assert.equal(invoice!.totalCost, 60) // 2 × 30
  })

  test('generate with no uninvoiced orders redirects with info flash', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()

    const response = await client
      .post('/supplier/invoice/generate')
      .loginAs(supplier)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/supplier/invoice')

    const invoiceCount = await Invoice.query().where('supplierId', supplier.id).count('* as total')
    assert.equal(Number(invoiceCount[0].$extras.total), 0)
  })

  test('admin can also generate invoices (has supplier access)', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: admin.id,
      productId: product.id,
      amountLeft: 3,
      price: 10,
    }).create()

    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()

    const response = await client
      .post('/supplier/invoice/generate')
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    const invoice = await Invoice.query().where('supplierId', admin.id).first()
    assert.isNotNull(invoice)
  })
})

test.group('Web Supplier - payments (approve/reject)', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('supplier can view payments page', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client.get('/supplier/payments').loginAs(supplier)
    response.assertStatus(200)
  })

  test('supplier can approve a payment request', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client
      .post(`/supplier/payments/${invoice.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ action: 'approve' })
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/supplier/payments')

    await invoice.refresh()
    assert.isTrue(invoice.isPaid)
  })

  test('supplier can reject a payment request', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client
      .post(`/supplier/payments/${invoice.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ action: 'reject' })
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/supplier/payments')

    await invoice.refresh()
    assert.isFalse(invoice.isPaid)
    assert.isFalse(invoice.isPaymentRequested)
  })

  test('supplier cannot approve another supplier\'s invoice', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const otherSupplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client
      .post(`/supplier/payments/${invoice.id}`)
      .loginAs(otherSupplier)
      .withCsrfToken()
      .json({ action: 'approve' })
      .redirects(0)

    response.assertStatus(302)

    // Invoice should not be paid
    await invoice.refresh()
    assert.isFalse(invoice.isPaid)
    assert.isTrue(invoice.isPaymentRequested)
  })

  test('customer cannot access payment actions', async ({ client }) => {
    const customer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client
      .post(`/supplier/payments/${invoice.id}`)
      .loginAs(customer)
      .withCsrfToken()
      .json({ action: 'approve' })
      .redirects(0)

    // Customer is redirected (role middleware)
    response.assertStatus(302)
  })

  test('approve action requires valid action field', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client
      .post(`/supplier/payments/${invoice.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ action: 'invalid_action' })
      .redirects(0)

    // Web route: validation failure redirects back (not 422)
    assert.notEqual(response.status(), 200)

    // Invoice should not have changed
    await invoice.refresh()
    assert.isFalse(invoice.isPaid)
  })
})
