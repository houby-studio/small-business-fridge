import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { InvoiceFactory } from '#database/factories/invoice_factory'
import { OrderFactory } from '#database/factories/order_factory'
import InvoiceService from '#services/invoice_service'
import Order from '#models/order'
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

test.group('InvoiceService - getInvoicesForBuyer status filter', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('filter by paid returns only paid invoices', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()

    await InvoiceFactory.apply('paid')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()
    await InvoiceFactory.merge({ buyerId: buyer.id, supplierId: supplier.id }).create()
    await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const result = await invoiceService.getInvoicesForBuyer(buyer.id, 1, 20, { status: 'paid' })
    assert.equal(result.all().length, 1)
    assert.isTrue(result.all()[0].isPaid)
  })

  test('filter by unpaid returns only unpaid invoices (not requested)', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()

    await InvoiceFactory.apply('paid')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()
    await InvoiceFactory.merge({ buyerId: buyer.id, supplierId: supplier.id }).create()
    await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const result = await invoiceService.getInvoicesForBuyer(buyer.id, 1, 20, { status: 'unpaid' })
    assert.equal(result.all().length, 1)
    assert.isFalse(result.all()[0].isPaid)
    assert.isFalse(result.all()[0].isPaymentRequested)
  })

  test('filter by awaiting returns only payment-requested invoices', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()

    await InvoiceFactory.apply('paid')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()
    await InvoiceFactory.merge({ buyerId: buyer.id, supplierId: supplier.id }).create()
    await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const result = await invoiceService.getInvoicesForBuyer(buyer.id, 1, 20, {
      status: 'awaiting',
    })
    assert.equal(result.all().length, 1)
    assert.isTrue(result.all()[0].isPaymentRequested)
    assert.isFalse(result.all()[0].isPaid)
  })

  test('no filter returns all invoices', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()

    await InvoiceFactory.apply('paid')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()
    await InvoiceFactory.merge({ buyerId: buyer.id, supplierId: supplier.id }).create()
    await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const result = await invoiceService.getInvoicesForBuyer(buyer.id, 1, 20)
    assert.equal(result.all().length, 3)
  })
})

test.group('InvoiceService - generateInvoiceForBuyer', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('generates invoice for specific buyer only', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer1 = await UserFactory.create()
    const buyer2 = await UserFactory.create()
    const delivery = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
      .merge({ supplierId: supplier.id, amountSupplied: 10, amountLeft: 8, price: 20 })
      .create()

    await OrderFactory.merge({ buyerId: buyer1.id, deliveryId: delivery.id }).create()
    await OrderFactory.merge({ buyerId: buyer2.id, deliveryId: delivery.id }).create()

    const invoice = await invoiceService.generateInvoiceForBuyer(supplier.id, buyer1.id)

    assert.isNotNull(invoice)
    assert.equal(invoice!.buyerId, buyer1.id)
    assert.equal(invoice!.supplierId, supplier.id)
    assert.equal(invoice!.totalCost, 20)

    // buyer2's order must remain uninvoiced
    const remaining = await invoiceService.generateInvoiceForBuyer(supplier.id, buyer2.id)
    assert.isNotNull(remaining)
  })

  test('returns null when no uninvoiced orders for that buyer+supplier pair', async ({
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()

    const result = await invoiceService.generateInvoiceForBuyer(supplier.id, buyer.id)
    assert.isNull(result)
  })

  test('links orders to the created invoice', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const delivery = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
      .merge({ supplierId: supplier.id, amountSupplied: 5, amountLeft: 3, price: 15 })
      .create()

    const order1 = await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()
    const order2 = await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()

    const invoice = await invoiceService.generateInvoiceForBuyer(supplier.id, buyer.id)

    assert.isNotNull(invoice)
    await order1.refresh()
    await order2.refresh()
    assert.equal(order1.invoiceId, invoice!.id)
    assert.equal(order2.invoiceId, invoice!.id)
  })

  test('does not invoice orders from a different supplier', async ({ assert }) => {
    const supplier1 = await UserFactory.apply('supplier').create()
    const supplier2 = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()

    const delivery1 = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
      .merge({ supplierId: supplier1.id, amountSupplied: 5, amountLeft: 4, price: 10 })
      .create()
    const delivery2 = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
      .merge({ supplierId: supplier2.id, amountSupplied: 5, amountLeft: 4, price: 20 })
      .create()

    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery1.id }).create()
    const order2 = await OrderFactory.merge({
      buyerId: buyer.id,
      deliveryId: delivery2.id,
    }).create()

    // Only generate for supplier1
    await invoiceService.generateInvoiceForBuyer(supplier1.id, buyer.id)

    // supplier2's order must still be uninvoiced
    await order2.refresh()
    assert.isNull(order2.invoiceId)
  })
})

test.group('InvoiceService - generateInvoicesForUser', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('creates invoices grouped by supplier for one buyer', async ({ assert }) => {
    const supplier1 = await UserFactory.apply('supplier').create()
    const supplier2 = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()

    const delivery1 = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
      .merge({ supplierId: supplier1.id, amountSupplied: 5, amountLeft: 4, price: 10 })
      .create()
    const delivery2 = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
      .merge({ supplierId: supplier2.id, amountSupplied: 5, amountLeft: 4, price: 25 })
      .create()

    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery1.id }).create()
    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery2.id }).create()

    const invoices = await invoiceService.generateInvoicesForUser(buyer.id, buyer.id)

    assert.lengthOf(invoices, 2)
    const supplierIds = invoices.map((i) => i.supplierId).sort()
    assert.deepEqual(supplierIds, [supplier1.id, supplier2.id].sort())
  })

  test('returns empty array when no uninvoiced orders', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const invoices = await invoiceService.generateInvoicesForUser(buyer.id, buyer.id)
    assert.lengthOf(invoices, 0)
  })

  test('links orders to their respective invoices', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const delivery = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
      .merge({ supplierId: supplier.id, amountSupplied: 5, amountLeft: 3, price: 10 })
      .create()

    const order1 = await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()
    const order2 = await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()

    const invoices = await invoiceService.generateInvoicesForUser(buyer.id, buyer.id)
    assert.lengthOf(invoices, 1)

    await order1.refresh()
    await order2.refresh()
    assert.equal(order1.invoiceId, invoices[0].id)
    assert.equal(order2.invoiceId, invoices[0].id)
  })

  test('does not affect orders belonging to other buyers', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer1 = await UserFactory.create()
    const buyer2 = await UserFactory.create()
    const delivery = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
      .merge({ supplierId: supplier.id, amountSupplied: 10, amountLeft: 8, price: 10 })
      .create()

    await OrderFactory.merge({ buyerId: buyer1.id, deliveryId: delivery.id }).create()
    const order2 = await OrderFactory.merge({
      buyerId: buyer2.id,
      deliveryId: delivery.id,
    }).create()

    await invoiceService.generateInvoicesForUser(buyer1.id, buyer1.id)

    // buyer2's order must remain uninvoiced
    await order2.refresh()
    assert.isNull(order2.invoiceId)

    // buyer2 still shows as having uninvoiced orders
    const stillUninvoiced = await invoiceService.getUninvoicedBuyerIds([buyer2.id])
    assert.isTrue(stillUninvoiced.has(buyer2.id))
  })
})

test.group('InvoiceService - getUninvoicedBuyerIds / getUnpaidBuyerIds', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('getUninvoicedBuyerIds returns correct set of IDs', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer1 = await UserFactory.create()
    const buyer2 = await UserFactory.create()
    const delivery = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
      .merge({ supplierId: supplier.id, amountSupplied: 10, amountLeft: 8, price: 10 })
      .create()

    await OrderFactory.merge({ buyerId: buyer1.id, deliveryId: delivery.id }).create()

    const result = await invoiceService.getUninvoicedBuyerIds([buyer1.id, buyer2.id])

    assert.isTrue(result.has(buyer1.id))
    assert.isFalse(result.has(buyer2.id))
  })

  test('getUninvoicedBuyerIds returns empty Set for empty input', async ({ assert }) => {
    const result = await invoiceService.getUninvoicedBuyerIds([])
    assert.equal(result.size, 0)
  })

  test('getUnpaidBuyerIds returns correct set of IDs', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer1 = await UserFactory.create()
    const buyer2 = await UserFactory.create()

    await InvoiceFactory.merge({ buyerId: buyer1.id, supplierId: supplier.id }).create()
    await InvoiceFactory.apply('paid')
      .merge({ buyerId: buyer2.id, supplierId: supplier.id })
      .create()

    const result = await invoiceService.getUnpaidBuyerIds([buyer1.id, buyer2.id])

    assert.isTrue(result.has(buyer1.id))
    assert.isFalse(result.has(buyer2.id))
  })

  test('getUnpaidBuyerIds returns empty Set for empty input', async ({ assert }) => {
    const result = await invoiceService.getUnpaidBuyerIds([])
    assert.equal(result.size, 0)
  })

  test('getUninvoicedBuyerIds excludes buyers with already-invoiced orders', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const delivery = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
      .merge({ supplierId: supplier.id, amountSupplied: 5, amountLeft: 4, price: 10 })
      .create()

    const invoice = await InvoiceFactory.merge({
      buyerId: buyer.id,
      supplierId: supplier.id,
    }).create()
    // Order is invoiced
    await OrderFactory.merge({
      buyerId: buyer.id,
      deliveryId: delivery.id,
      invoiceId: invoice.id,
    }).create()

    const result = await invoiceService.getUninvoicedBuyerIds([buyer.id])
    assert.isFalse(result.has(buyer.id))
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
