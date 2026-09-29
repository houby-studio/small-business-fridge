import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { UserFactory } from '#database/factories/user_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import DeliveryService from '#services/delivery_service'
import OrderService from '#services/order_service'
import InvoiceService from '#services/invoice_service'
import { isDomainError } from '#services/domain_error'
import Delivery from '#models/delivery'
import Order from '#models/order'
import Invoice from '#models/invoice'
import DeliveryCorrection from '#models/delivery_correction'
import db from '@adonisjs/lucid/services/db'

const service = new DeliveryService()
const orderService = new OrderService()
const invoiceService = new InvoiceService()

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('orders').delete()
  await db.from('invoices').delete()
  await db.from('delivery_corrections').delete()
  await db.from('deliveries').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('users').delete()
}

async function setup(options: { amount?: number; price?: number } = {}) {
  const supplier = await UserFactory.apply('supplier').create()
  const category = await CategoryFactory.create()
  const product = await ProductFactory.merge({ categoryId: category.id }).create()
  const amount = options.amount ?? 10
  const delivery = await DeliveryFactory.merge({
    supplierId: supplier.id,
    productId: product.id,
    amountSupplied: amount,
    amountLeft: amount,
    price: options.price ?? 1,
  }).create()
  return { supplier, product, delivery }
}

async function expectDomainError(fn: () => Promise<unknown>, code: string) {
  try {
    await fn()
  } catch (error) {
    if (isDomainError(error, code)) return
    throw error
  }
  throw new Error(`Expected DomainError ${code}`)
}

test.group('DeliveryService.correctDelivery', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('reprices uninvoiced purchases and keeps invoiced ones', async ({ assert }) => {
    const { supplier, delivery } = await setup({ amount: 10, price: 1 })
    const buyerA = await UserFactory.create()
    const buyerB = await UserFactory.create()

    // Buyer A buys 2 and gets invoiced; afterwards A and B buy one more each.
    await orderService.purchase(buyerA.id, delivery.id, 'web')
    await orderService.purchase(buyerA.id, delivery.id, 'web')
    const invoice = await invoiceService.generateInvoiceForBuyer(supplier.id, buyerA.id)
    assert.exists(invoice)
    const lateA = await orderService.purchase(buyerA.id, delivery.id, 'web')
    const lateB = await orderService.purchase(buyerB.id, delivery.id, 'kiosk')

    const { correction } = await service.correctDelivery(supplier, delivery.id, {
      amount: 10,
      price: 25,
      reason: 'Price typo',
    })

    assert.equal(correction.repricedOrderCount, 2)
    assert.equal(correction.oldPrice, 1)
    assert.equal(correction.newPrice, 25)

    const invoiced = await Order.query().where('invoiceId', invoice!.id)
    assert.lengthOf(invoiced, 2)
    for (const order of invoiced) {
      assert.equal(order.unitPrice, 1)
      assert.isNull(order.originalUnitPrice)
    }

    for (const id of [lateA.id, lateB.id]) {
      const order = await Order.findOrFail(id)
      assert.equal(order.unitPrice, 25)
      assert.equal(order.originalUnitPrice, 1)
      assert.equal(order.priceCorrectionId, correction.id)
    }

    // The issued invoice keeps its total; the next one uses the corrected price.
    await invoice!.refresh()
    assert.equal(invoice!.totalCost, 2)
    const next = await invoiceService.generateInvoiceForBuyer(supplier.id, buyerA.id)
    assert.equal(next!.totalCost, 25)

    const reloaded = await Delivery.findOrFail(delivery.id)
    assert.equal(reloaded.price, 25)
    assert.equal(reloaded.amountLeft, 6)
  })

  test('a second correction keeps the price at purchase time as the original', async ({
    assert,
  }) => {
    const { supplier, delivery } = await setup({ price: 1 })
    const buyer = await UserFactory.create()
    const order = await orderService.purchase(buyer.id, delivery.id, 'web')

    await service.correctDelivery(supplier, delivery.id, { amount: 10, price: 250, reason: 'x1' })
    const { correction } = await service.correctDelivery(supplier, delivery.id, {
      amount: 10,
      price: 25,
      reason: 'Second typo',
    })

    await order.refresh()
    assert.equal(order.unitPrice, 25)
    assert.equal(order.originalUnitPrice, 1)
    assert.equal(order.priceCorrectionId, correction.id)
  })

  test('changing the amount adjusts the remaining stock by the same delta', async ({ assert }) => {
    const { supplier, delivery } = await setup({ amount: 20, price: 10 })
    const buyer = await UserFactory.create()
    await orderService.purchase(buyer.id, delivery.id, 'web')
    await orderService.purchase(buyer.id, delivery.id, 'web')

    const { correction } = await service.correctDelivery(supplier, delivery.id, {
      amount: 12,
      price: 10,
      reason: 'Stocked 12, not 20',
    })

    const reloaded = await Delivery.findOrFail(delivery.id)
    assert.equal(reloaded.amountSupplied, 12)
    assert.equal(reloaded.amountLeft, 10)
    assert.equal(correction.repricedOrderCount, 0)
    assert.equal(correction.oldAmountSupplied, 20)

    // The audit entry lists only what changed.
    const log = await db.from('audit_logs').where('action', 'delivery.corrected').firstOrFail()
    assert.deepEqual(log.metadata.amountSupplied, { from: 20, to: 12 })
    assert.notProperty(log.metadata, 'price')
    assert.notProperty(log.metadata, 'repricedOrderCount')
  })

  test('the amount cannot drop below what was already sold', async ({ assert }) => {
    const { supplier, delivery } = await setup({ amount: 5, price: 10 })
    const buyer = await UserFactory.create()
    await orderService.purchase(buyer.id, delivery.id, 'web')
    await orderService.purchase(buyer.id, delivery.id, 'web')

    await expectDomainError(
      () => service.correctDelivery(supplier, delivery.id, { amount: 1, price: 10, reason: 'x' }),
      'AMOUNT_BELOW_SOLD'
    )

    const reloaded = await Delivery.findOrFail(delivery.id)
    assert.equal(reloaded.amountSupplied, 5)
    assert.lengthOf(await DeliveryCorrection.all(), 0)
  })

  test('the amount can never be increased — extra pieces are a new delivery', async ({
    assert,
  }) => {
    const { supplier, delivery } = await setup({ amount: 5, price: 10 })
    const admin = await UserFactory.apply('admin').create()

    // Topping up an old delivery would let it jump the FIFO queue; not even an admin may.
    for (const actor of [supplier, admin]) {
      await expectDomainError(
        () => service.correctDelivery(actor, delivery.id, { amount: 6, price: 10, reason: 'x' }),
        'AMOUNT_INCREASE_NOT_ALLOWED'
      )
    }

    const reloaded = await Delivery.findOrFail(delivery.id)
    assert.equal(reloaded.amountSupplied, 5)
    assert.equal(reloaded.amountLeft, 5)
    assert.lengthOf(await DeliveryCorrection.all(), 0)
  })

  test('rejects a correction that changes nothing', async () => {
    const { supplier, delivery } = await setup({ amount: 5, price: 10 })
    await expectDomainError(
      () => service.correctDelivery(supplier, delivery.id, { amount: 5, price: 10, reason: 'x' }),
      'NO_CHANGE'
    )
  })

  test('another supplier cannot correct the delivery, an admin can', async ({ assert }) => {
    const { delivery } = await setup({ amount: 5, price: 10 })
    const other = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()

    await expectDomainError(
      () => service.correctDelivery(other, delivery.id, { amount: 4, price: 10, reason: 'x' }),
      'FORBIDDEN'
    )

    const { correction } = await service.correctDelivery(admin, delivery.id, {
      amount: 4,
      price: 10,
      reason: 'Admin fix',
    })
    assert.equal(correction.actorId, admin.id)

    const log = await db.from('audit_logs').where('action', 'delivery.corrected').first()
    assert.exists(log)
    assert.equal(log.user_id, admin.id)
    assert.equal(log.target_user_id, delivery.supplierId)
  })
})

test.group('DeliveryService.voidDelivery', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('voids an unsold delivery and keeps the row for history', async ({ assert }) => {
    const { supplier, delivery } = await setup({ amount: 12, price: 30 })

    const { correction } = await service.voidDelivery(supplier, delivery.id, 'Stocked twice')

    const reloaded = await Delivery.findOrFail(delivery.id)
    assert.isNotNull(reloaded.voidedAt)
    assert.equal(reloaded.amountSupplied, 0)
    assert.equal(reloaded.amountLeft, 0)
    assert.equal(correction.kind, 'void')
    assert.equal(correction.oldAmountSupplied, 12)
    assert.equal(correction.oldPrice, 30)

    const log = await db.from('audit_logs').where('action', 'delivery.voided').first()
    assert.exists(log)
  })

  test('refuses to void a delivery someone bought from', async ({ assert }) => {
    const { supplier, delivery } = await setup({ amount: 12, price: 30 })
    const buyer = await UserFactory.create()
    await orderService.purchase(buyer.id, delivery.id, 'web')

    await expectDomainError(
      () => service.voidDelivery(supplier, delivery.id, 'Stocked twice'),
      'DELIVERY_HAS_ORDERS'
    )

    const reloaded = await Delivery.findOrFail(delivery.id)
    assert.isNull(reloaded.voidedAt)
    assert.equal(reloaded.amountLeft, 11)
  })

  test('a voided delivery cannot be corrected or voided again', async () => {
    const { supplier, delivery } = await setup({ amount: 12, price: 30 })
    await service.voidDelivery(supplier, delivery.id, 'Stocked twice')

    await expectDomainError(
      () => service.correctDelivery(supplier, delivery.id, { amount: 5, price: 30, reason: 'x' }),
      'DELIVERY_VOIDED'
    )
    await expectDomainError(
      () => service.voidDelivery(supplier, delivery.id, 'again'),
      'DELIVERY_VOIDED'
    )
  })

  test('a voided delivery drops out of the stock overview', async ({ assert }) => {
    const { supplier, product, delivery } = await setup({ amount: 12, price: 30 })
    await service.voidDelivery(supplier, delivery.id, 'Stocked twice')

    const stock = await service.getStockForSupplier(supplier.id, 1, 20)
    assert.notInclude(
      stock.data.map((row) => row.productId),
      product.id
    )
  })
})

test.group('DeliveryService.getStockWarnings', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('returns null for a first delivery of a product', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()

    assert.isNull(await service.getStockWarnings(supplier.id, product.id, 25))
  })

  test('flags a repeated delivery of the same product by the same supplier', async ({ assert }) => {
    const { supplier, product } = await setup({ amount: 12, price: 25 })

    const warnings = await service.getStockWarnings(supplier.id, product.id, 25)
    assert.exists(warnings?.duplicate)
    assert.equal(warnings!.duplicate!.amount, 12)
    assert.equal(warnings!.duplicate!.price, 25)
    assert.isNull(warnings!.unusualPrice)
  })

  test('does not flag an older delivery as a duplicate', async ({ assert }) => {
    const { supplier, product, delivery } = await setup({ amount: 12, price: 25 })
    await db
      .from('deliveries')
      .where('id', delivery.id)
      .update({ created_at: DateTime.now().minus({ hours: 2 }).toJSDate() })

    assert.isNull(await service.getStockWarnings(supplier.id, product.id, 26))
  })

  test('flags a price far from the last delivery of the product', async ({ assert }) => {
    const { product } = await setup({ amount: 12, price: 25 })
    const other = await UserFactory.apply('supplier').create()

    const tooHigh = await service.getStockWarnings(other.id, product.id, 250)
    assert.isNull(tooHigh?.duplicate)
    assert.equal(tooHigh?.unusualPrice?.lastPrice, 25)
    assert.isString(tooHigh?.unusualPrice?.lastSupplierName)

    const tooLow = await service.getStockWarnings(other.id, product.id, 2)
    assert.equal(tooLow?.unusualPrice?.lastPrice, 25)

    assert.isNull(await service.getStockWarnings(other.id, product.id, 30))
  })

  test('small absolute differences on cheap items are not flagged', async ({ assert }) => {
    const { product } = await setup({ amount: 12, price: 2 })
    const other = await UserFactory.apply('supplier').create()

    // 2 → 7 Kč is 3.5×, but only 5 Kč apart — not worth interrupting the supplier.
    assert.isNull(await service.getStockWarnings(other.id, product.id, 7))
    // 2 → 8 Kč is both 4× and more than 5 Kč apart.
    const flagged = await service.getStockWarnings(other.id, product.id, 8)
    assert.equal(flagged?.unusualPrice?.lastPrice, 2)
  })

  test('a large ratio with a big difference is flagged in both directions', async ({ assert }) => {
    const { product } = await setup({ amount: 12, price: 15 })
    const other = await UserFactory.apply('supplier').create()

    // 15 → 22 Kč: 7 Kč apart but under 1.5× — not flagged.
    assert.isNull(await service.getStockWarnings(other.id, product.id, 22))
    // 15 → 23 Kč: 1.53× and 8 Kč apart.
    const higher = await service.getStockWarnings(other.id, product.id, 23)
    assert.exists(higher?.unusualPrice)
    // 15 → 10 Kč: exactly 1.5× lower but only 5 Kč apart — not flagged.
    assert.isNull(await service.getStockWarnings(other.id, product.id, 10))
    // 15 → 9 Kč: below 1.5× lower and 6 Kč apart.
    const lower = await service.getStockWarnings(other.id, product.id, 9)
    assert.exists(lower?.unusualPrice)
  })

  test('ignores voided deliveries', async ({ assert }) => {
    const { supplier, product, delivery } = await setup({ amount: 12, price: 250 })
    await service.voidDelivery(supplier, delivery.id, 'typo')

    assert.isNull(await service.getStockWarnings(supplier.id, product.id, 25))
  })
})

test.group('Order unit price snapshot', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a purchase stores the delivery price on the order', async ({ assert }) => {
    const { delivery } = await setup({ price: 37 })
    const buyer = await UserFactory.create()

    const order = await orderService.purchase(buyer.id, delivery.id, 'web')
    await order.refresh()
    assert.equal(order.unitPrice, 37)
  })

  test('an order created without a price falls back to the delivery price', async ({ assert }) => {
    const { delivery } = await setup({ price: 42 })
    const buyer = await UserFactory.create()

    const order = await Order.create({ buyerId: buyer.id, deliveryId: delivery.id, channel: 'web' })
    assert.equal(order.unitPrice, 42)
  })

  test('invoice totals use the order price, not the current delivery price', async ({ assert }) => {
    const { supplier, delivery } = await setup({ price: 10 })
    const buyer = await UserFactory.create()
    await orderService.purchase(buyer.id, delivery.id, 'web')

    // Simulate a delivery price that drifted without a correction.
    await db.from('deliveries').where('id', delivery.id).update({ price: 99 })

    const invoice = await invoiceService.generateInvoiceForBuyer(supplier.id, buyer.id)
    assert.equal(invoice!.totalCost, 10)
    const stored = await Invoice.findOrFail(invoice!.id)
    assert.equal(stored.totalCost, 10)
  })
})
