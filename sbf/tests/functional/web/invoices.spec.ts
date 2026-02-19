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
