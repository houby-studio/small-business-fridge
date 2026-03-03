import '#tests/test_context'
import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import { InvoiceFactory } from '#database/factories/invoice_factory'
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

test.group('Web Invoices - index', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('renders invoices page for authenticated user', async ({ client }) => {
    const user = await UserFactory.create()
    const response = await client.get('/invoices').loginAs(user)
    response.assertStatus(200)
  })

  test('redirects unauthenticated user', async ({ client }) => {
    const response = await client.get('/invoices').redirects(0)
    response.assertStatus(302)
  })
})

test.group('Web Invoices - requestPaid', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('buyer can request payment on their invoice', async ({ client, assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const invoice = await InvoiceFactory.merge({
      buyerId: buyer.id,
      supplierId: supplier.id,
    }).create()

    const response = await client
      .post(`/invoices/${invoice.id}/request-paid`)
      .loginAs(buyer)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/invoices')

    await invoice.refresh()
    assert.isTrue(invoice.isPaymentRequested)
  })

  test("buyer cannot request payment on another buyer's invoice", async ({ client, assert }) => {
    const buyer = await UserFactory.create()
    const otherBuyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const invoice = await InvoiceFactory.merge({
      buyerId: buyer.id,
      supplierId: supplier.id,
    }).create()

    const response = await client
      .post(`/invoices/${invoice.id}/request-paid`)
      .loginAs(otherBuyer)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    // Invoice should not be changed (FORBIDDEN triggers redirect to /invoices, but state unchanged)
    await invoice.refresh()
    assert.isFalse(invoice.isPaymentRequested)
  })

  test('requestPaid on already-paid invoice redirects with info flash', async ({
    client,
    assert,
  }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const invoice = await InvoiceFactory.apply('paid')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client
      .post(`/invoices/${invoice.id}/request-paid`)
      .loginAs(buyer)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/invoices')

    // Invoice is still paid
    await invoice.refresh()
    assert.isTrue(invoice.isPaid)
  })

  test('requires authentication', async ({ client }) => {
    const response = await client.post('/invoices/1/request-paid').redirects(0)
    response.assertStatus(302)
  })
})

test.group('Web Invoices - status filter', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('filter by status=paid returns 200', async ({ client }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    await InvoiceFactory.apply('paid')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()
    await InvoiceFactory.merge({ buyerId: buyer.id, supplierId: supplier.id }).create()

    const response = await client.get('/invoices?status=paid').loginAs(buyer)
    response.assertStatus(200)
  })

  test('filter by status=unpaid returns 200', async ({ client }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    await InvoiceFactory.merge({ buyerId: buyer.id, supplierId: supplier.id }).create()

    const response = await client.get('/invoices?status=unpaid').loginAs(buyer)
    response.assertStatus(200)
  })

  test('filter by status=awaiting returns 200', async ({ client }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client.get('/invoices?status=awaiting').loginAs(buyer)
    response.assertStatus(200)
  })
})

test.group('Web Invoices - cancelPaid', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('buyer can cancel their payment request', async ({ client, assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client
      .post(`/invoices/${invoice.id}/cancel-paid`)
      .loginAs(buyer)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/invoices')

    await invoice.refresh()
    assert.isFalse(invoice.isPaymentRequested)

    const log = await db
      .from('audit_logs')
      .where('action', 'payment.request_cancelled')
      .where('user_id', buyer.id)
      .where('entity_type', 'invoice')
      .where('entity_id', invoice.id)
      .first()
    assert.isDefined(log)
    const metadata = log.metadata as { isPaymentRequested?: { from: boolean; to: boolean } } | null
    assert.deepEqual(metadata?.isPaymentRequested, { from: true, to: false })
  })

  test("buyer cannot cancel another buyer's payment request", async ({ client, assert }) => {
    const buyer = await UserFactory.create()
    const otherBuyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client
      .post(`/invoices/${invoice.id}/cancel-paid`)
      .loginAs(otherBuyer)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    // Invoice should remain unchanged
    await invoice.refresh()
    assert.isTrue(invoice.isPaymentRequested)
  })
})

test.group('Web Invoices - qrcode', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('can generate QR for older invoice even with more than 1000 invoices', async ({
    client,
    assert,
  }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').apply('withIban').create()
    const targetInvoice = await InvoiceFactory.merge({
      buyerId: buyer.id,
      supplierId: supplier.id,
      totalCost: 123,
    }).create()

    const now = new Date()
    const bulk = Array.from({ length: 1000 }, (_, index) => ({
      buyer_id: buyer.id,
      supplier_id: supplier.id,
      total_cost: 10 + (index % 5),
      is_paid: false,
      is_payment_requested: false,
      auto_reminder_count: 0,
      manual_reminder_count: 0,
      created_at: now,
      updated_at: now,
    }))
    await db.table('invoices').multiInsert(bulk)

    const response = await client
      .post(`/invoices/${targetInvoice.id}/qrcode`)
      .loginAs(buyer)
      .withCsrfToken()

    response.assertStatus(200)
    assert.exists(response.body().code)
    assert.exists(response.body().imageData)
    assert.include(response.body().code as string, supplier.iban as string)
  })
})
