import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { InvoiceFactory } from '#database/factories/invoice_factory'
import { OrderFactory } from '#database/factories/order_factory'
import InvoiceService from '#services/invoice_service'
import db from '@adonisjs/lucid/services/db'

const invoiceService = new InvoiceService()

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

test.group('InvoiceService - generateInvoices', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('generates one invoice per buyer for uninvoiced orders', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const delivery = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
      .merge({ supplierId: supplier.id, amountSupplied: 5, amountLeft: 4, price: 20 })
      .create()

    // Create 2 uninvoiced orders for same buyer
    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).createMany(2)

    const invoices = await invoiceService.generateInvoices(supplier.id)

    assert.lengthOf(invoices, 1)
    assert.equal(invoices[0].buyerId, buyer.id)
    assert.equal(invoices[0].supplierId, supplier.id)
    assert.equal(invoices[0].totalCost, 40) // 2 × 20
    assert.isFalse(invoices[0].isPaid)
    assert.isFalse(invoices[0].isPaymentRequested)
  })

  test('generates separate invoices for multiple buyers', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer1 = await UserFactory.create()
    const buyer2 = await UserFactory.create()
    const delivery = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
      .merge({ supplierId: supplier.id, amountSupplied: 10, amountLeft: 8, price: 15 })
      .create()

    await OrderFactory.merge({ buyerId: buyer1.id, deliveryId: delivery.id }).create()
    await OrderFactory.merge({ buyerId: buyer2.id, deliveryId: delivery.id }).create()

    const invoices = await invoiceService.generateInvoices(supplier.id)

    assert.lengthOf(invoices, 2)
    assert.equal(invoices[0].totalCost, 15)
    assert.equal(invoices[1].totalCost, 15)
  })

  test('links orders to created invoice', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const delivery = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
      .merge({ supplierId: supplier.id, amountSupplied: 5, amountLeft: 4, price: 10 })
      .create()

    const order = await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()

    const invoices = await invoiceService.generateInvoices(supplier.id)
    assert.lengthOf(invoices, 1)

    await order.refresh()
    assert.equal(order.invoiceId, invoices[0].id)
  })

  test('returns empty array when no uninvoiced orders', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const invoices = await invoiceService.generateInvoices(supplier.id)
    assert.lengthOf(invoices, 0)
  })

  test('skips already-invoiced orders', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const delivery = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
      .merge({ supplierId: supplier.id, amountSupplied: 5, amountLeft: 4, price: 10 })
      .create()

    // Create an already-invoiced order
    const existingInvoice = await InvoiceFactory.merge({
      buyerId: buyer.id,
      supplierId: supplier.id,
    }).create()
    await OrderFactory.merge({
      buyerId: buyer.id,
      deliveryId: delivery.id,
      invoiceId: existingInvoice.id,
    }).create()

    const newInvoices = await invoiceService.generateInvoices(supplier.id)
    assert.lengthOf(newInvoices, 0)
  })

  test('self-invoice is auto-marked as paid', async ({ assert }) => {
    // Supplier who is also a customer buys their own product
    const supplier = await UserFactory.apply('supplier').create()
    const delivery = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
      .merge({ supplierId: supplier.id, amountSupplied: 5, amountLeft: 4, price: 25 })
      .create()

    // Supplier buys their own product (buyerId === supplierId)
    await OrderFactory.merge({ buyerId: supplier.id, deliveryId: delivery.id }).create()

    const invoices = await invoiceService.generateInvoices(supplier.id)

    assert.lengthOf(invoices, 1)
    assert.isTrue(invoices[0].isPaid)
    assert.isTrue(invoices[0].isPaymentRequested)
  })
})

test.group('InvoiceService - requestPayment / cancelPaymentRequest', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('buyer can request payment on their own invoice', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const invoice = await InvoiceFactory.merge({
      buyerId: buyer.id,
      supplierId: supplier.id,
    }).create()

    await invoiceService.requestPayment(invoice.id, buyer.id)

    await invoice.refresh()
    assert.isTrue(invoice.isPaymentRequested)
    assert.isFalse(invoice.isPaid)
  })

  test('requestPayment throws FORBIDDEN for wrong buyer', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const otherUser = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const invoice = await InvoiceFactory.merge({
      buyerId: buyer.id,
      supplierId: supplier.id,
    }).create()

    await assert.rejects(() => invoiceService.requestPayment(invoice.id, otherUser.id), 'FORBIDDEN')
  })

  test('requestPayment throws ALREADY_PAID for paid invoice', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const invoice = await InvoiceFactory.apply('paid')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    await assert.rejects(() => invoiceService.requestPayment(invoice.id, buyer.id), 'ALREADY_PAID')
  })

  test('buyer can cancel their payment request', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    await invoiceService.cancelPaymentRequest(invoice.id, buyer.id)

    await invoice.refresh()
    assert.isFalse(invoice.isPaymentRequested)
  })

  test('cancelPaymentRequest throws FORBIDDEN for wrong buyer', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const otherUser = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    await assert.rejects(
      () => invoiceService.cancelPaymentRequest(invoice.id, otherUser.id),
      'FORBIDDEN'
    )
  })
})

test.group('InvoiceService - approvePayment / rejectPayment', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('supplier can approve a payment request', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    await invoiceService.approvePayment(invoice.id, supplier.id)

    await invoice.refresh()
    assert.isTrue(invoice.isPaid)
  })

  test('approvePayment throws FORBIDDEN for wrong supplier', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const otherSupplier = await UserFactory.apply('supplier').create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    await assert.rejects(
      () => invoiceService.approvePayment(invoice.id, otherSupplier.id),
      'FORBIDDEN'
    )
  })

  test('supplier can reject a payment request (marks as unpaid)', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    await invoiceService.rejectPayment(invoice.id, supplier.id)

    await invoice.refresh()
    assert.isFalse(invoice.isPaid)
    assert.isFalse(invoice.isPaymentRequested)
  })

  test('rejectPayment throws FORBIDDEN for wrong supplier', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const otherSupplier = await UserFactory.apply('supplier').create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    await assert.rejects(
      () => invoiceService.rejectPayment(invoice.id, otherSupplier.id),
      'FORBIDDEN'
    )
  })
})

test.group('InvoiceService - getUninvoicedSummary', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('returns buyers with uninvoiced order totals', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const delivery = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
      .merge({ supplierId: supplier.id, amountSupplied: 10, amountLeft: 8, price: 30 })
      .create()

    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).createMany(2)

    const summary = await invoiceService.getUninvoicedSummary(supplier.id)

    assert.lengthOf(summary, 1)
    assert.equal(summary[0].buyerId, buyer.id)
    assert.equal(summary[0].orderCount, 2)
    assert.equal(summary[0].totalCost, 60)
  })

  test('excludes already-invoiced orders from summary', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const delivery = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
      .merge({ supplierId: supplier.id, amountSupplied: 10, amountLeft: 8, price: 10 })
      .create()

    const invoice = await InvoiceFactory.merge({
      buyerId: buyer.id,
      supplierId: supplier.id,
    }).create()
    await OrderFactory.merge({
      buyerId: buyer.id,
      deliveryId: delivery.id,
      invoiceId: invoice.id,
    }).create()

    const summary = await invoiceService.getUninvoicedSummary(supplier.id)
    assert.lengthOf(summary, 0)
  })
})
