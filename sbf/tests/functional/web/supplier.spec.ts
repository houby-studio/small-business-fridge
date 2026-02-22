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

test.group('Web Supplier - stock index', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('supplier can view stock page', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client.get('/supplier/stock').loginAs(supplier)
    response.assertStatus(200)
  })

  test('customer cannot access stock page', async ({ client }) => {
    const customer = await UserFactory.create()
    const response = await client.get('/supplier/stock').loginAs(customer).redirects(0)
    response.assertStatus(302)
  })

  test('stock page returns paginated stock with filters', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({
      categoryId: category.id,
      displayName: 'Cola Zero',
    }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 10,
      amountLeft: 5,
      price: 25,
    }).create()

    const response = await client.get('/supplier/stock?name=Cola').loginAs(supplier)
    response.assertStatus(200)
  })

  test('stock page inStock filter returns 200', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client.get('/supplier/stock?inStock=1').loginAs(supplier)
    response.assertStatus(200)
  })

  test('stock page sortBy totalRemaining returns 200', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client
      .get('/supplier/stock?sortBy=totalRemaining&sortOrder=asc')
      .loginAs(supplier)
    response.assertStatus(200)
  })
})

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

test.group('Web Supplier - generate invoice for single buyer', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('supplier can generate invoice for a specific buyer', async ({ client, assert }) => {
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

    const response = await client
      .post(`/supplier/invoice/generate/${buyer.id}`)
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
    assert.equal(invoice!.totalCost, 30)
  })

  test('generate for buyer with no orders redirects with info flash', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()

    const response = await client
      .post(`/supplier/invoice/generate/${buyer.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/supplier/invoice')

    const count = await Invoice.query().where('supplierId', supplier.id).count('* as total')
    assert.equal(Number(count[0].$extras.total), 0)
  })

  test('customer cannot call generate for buyer endpoint', async ({ client }) => {
    const customer = await UserFactory.create()
    const buyer = await UserFactory.create()

    const response = await client
      .post(`/supplier/invoice/generate/${buyer.id}`)
      .loginAs(customer)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    // Role middleware redirects customers away from supplier routes
  })

  test('generate for buyer only invoices calling supplier orders, not other suppliers', async ({
    client,
    assert,
  }) => {
    const supplier1 = await UserFactory.apply('supplier').create()
    const supplier2 = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()

    const product1 = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery1 = await DeliveryFactory.merge({
      supplierId: supplier1.id,
      productId: product1.id,
      amountLeft: 5,
      price: 10,
    }).create()

    const product2 = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery2 = await DeliveryFactory.merge({
      supplierId: supplier2.id,
      productId: product2.id,
      amountLeft: 5,
      price: 20,
    }).create()

    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery1.id }).create()
    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery2.id }).create()

    // supplier1 generates invoice for buyer
    const response = await client
      .post(`/supplier/invoice/generate/${buyer.id}`)
      .loginAs(supplier1)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    // Only supplier1's invoice should exist
    const invoice1 = await Invoice.query()
      .where('supplierId', supplier1.id)
      .where('buyerId', buyer.id)
      .first()
    assert.isNotNull(invoice1)
    assert.equal(invoice1!.totalCost, 10) // only supplier1's order

    // supplier2's order must still be uninvoiced
    const invoice2 = await Invoice.query()
      .where('supplierId', supplier2.id)
      .where('buyerId', buyer.id)
      .first()
    assert.isNull(invoice2)
  })
})

test.group('Web Supplier - payments status filter', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('filter by status=awaiting returns 200', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client.get('/supplier/payments?status=awaiting').loginAs(supplier)
    response.assertStatus(200)
  })

  test('filter by status=paid returns 200', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    await InvoiceFactory.apply('paid')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client.get('/supplier/payments?status=paid').loginAs(supplier)
    response.assertStatus(200)
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

  test("supplier cannot approve another supplier's invoice", async ({ client, assert }) => {
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
