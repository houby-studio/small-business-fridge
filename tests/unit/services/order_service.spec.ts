import '#tests/test_context'
import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import OrderService from '#services/order_service'
import Order from '#models/order'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import db from '@adonisjs/lucid/services/db'

const orderService = new OrderService()

test.group('OrderService', (group) => {
  group.each.setup(async () => {
    // Clean up orders, deliveries, users between tests
    await Order.query().delete()
    const { default: Delivery } = await import('#models/delivery')
    await Delivery.query().delete()
    const { default: Product } = await import('#models/product')
    await Product.query().delete()
    const { default: Category } = await import('#models/category')
    await Category.query().delete()
    const { default: User } = await import('#models/user')
    await User.query().delete()
  })

  test('purchase creates an order and decrements stock', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const delivery = await DeliveryFactory.with('supplier', 1, (s) => s.apply('supplier'))
      .with('product', 1, (p) => p.with('category'))
      .create()

    const initialStock = delivery.amountLeft

    const order = await orderService.purchase(buyer.id, delivery.id, 'web')

    assert.instanceOf(order, Order)
    assert.equal(order.buyerId, buyer.id)
    assert.equal(order.deliveryId, delivery.id)
    assert.equal(order.channel, 'web')

    // Verify stock decremented
    await delivery.refresh()
    assert.equal(delivery.amountLeft, initialStock - 1)
  })

  test('purchase with kiosk channel sets correct channel', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const delivery = await DeliveryFactory.with('supplier', 1, (s) => s.apply('supplier'))
      .with('product', 1, (p) => p.with('category'))
      .create()

    const order = await orderService.purchase(buyer.id, delivery.id, 'kiosk')
    assert.equal(order.channel, 'kiosk')
  })

  test('purchase with scanner channel sets correct channel', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const delivery = await DeliveryFactory.with('supplier', 1, (s) => s.apply('supplier'))
      .with('product', 1, (p) => p.with('category'))
      .create()

    const order = await orderService.purchase(buyer.id, delivery.id, 'scanner')
    assert.equal(order.channel, 'scanner')
  })

  test('purchase throws OUT_OF_STOCK when delivery is depleted', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const delivery = await DeliveryFactory.apply('depleted')
      .with('supplier', 1, (s) => s.apply('supplier'))
      .with('product', 1, (p) => p.with('category'))
      .create()

    await assert.rejects(() => orderService.purchase(buyer.id, delivery.id, 'web'), 'OUT_OF_STOCK')
  })

  test('purchase throws for non-existent delivery', async ({ assert }) => {
    const buyer = await UserFactory.create()

    await assert.rejects(() => orderService.purchase(buyer.id, 99999, 'web'), 'OUT_OF_STOCK')
  })

  test('multiple purchases decrement stock correctly', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const delivery = await DeliveryFactory.with('supplier', 1, (s) => s.apply('supplier'))
      .with('product', 1, (p) => p.with('category'))
      .merge({ amountSupplied: 3, amountLeft: 3 })
      .create()

    await orderService.purchase(buyer.id, delivery.id, 'web')
    await orderService.purchase(buyer.id, delivery.id, 'web')
    await orderService.purchase(buyer.id, delivery.id, 'web')

    await delivery.refresh()
    assert.equal(delivery.amountLeft, 0)

    // Fourth purchase should fail
    await assert.rejects(() => orderService.purchase(buyer.id, delivery.id, 'web'), 'OUT_OF_STOCK')
  })

  test('getOrdersForUser returns paginated orders with stats', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const delivery = await DeliveryFactory.with('supplier', 1, (s) => s.apply('supplier'))
      .with('product', 1, (p) => p.with('category'))
      .merge({ amountSupplied: 10, amountLeft: 10, price: 15 })
      .create()

    // Create 3 orders
    await orderService.purchase(buyer.id, delivery.id, 'web')
    await orderService.purchase(buyer.id, delivery.id, 'kiosk')
    await orderService.purchase(buyer.id, delivery.id, 'scanner')

    const result = await orderService.getOrdersForUser(buyer.id)

    assert.equal(result.stats.totalOrders, 3)
    assert.equal(result.stats.totalSpend, 45) // 3 × 15
    assert.equal(result.stats.totalUninvoiced, 45) // none invoiced
    assert.equal(result.stats.filteredOrders, 3)
    assert.equal(result.stats.filteredSpend, 45)
    assert.equal(result.stats.filteredUninvoiced, 45)
    assert.isFalse(result.stats.filtersApplied)
    assert.lengthOf(result.orders.toJSON().data, 3)
  })

  test('getOrdersForUser returns filtered stats when channel filter is active', async ({
    assert,
  }) => {
    const buyer = await UserFactory.create()
    const delivery = await DeliveryFactory.with('supplier', 1, (s) => s.apply('supplier'))
      .with('product', 1, (p) => p.with('category'))
      .merge({ amountSupplied: 10, amountLeft: 10, price: 20 })
      .create()

    await orderService.purchase(buyer.id, delivery.id, 'web')
    await orderService.purchase(buyer.id, delivery.id, 'web')
    await orderService.purchase(buyer.id, delivery.id, 'kiosk')

    const result = await orderService.getOrdersForUser(buyer.id, 1, 20, { channel: 'web' })

    assert.equal(result.stats.totalOrders, 3)
    assert.equal(result.stats.filteredOrders, 2)
    assert.equal(result.stats.totalSpend, 60)
    assert.equal(result.stats.filteredSpend, 40)
    assert.equal(result.stats.totalUninvoiced, 60)
    assert.equal(result.stats.filteredUninvoiced, 40)
    assert.isTrue(result.stats.filtersApplied)
  })

  test('purchaseBasket rejects FIFO skip within same product', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()

    const older = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 3,
      amountLeft: 3,
      price: 10,
    }).create()
    const newer = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 3,
      amountLeft: 3,
      price: 20,
    }).create()

    await db
      .from('deliveries')
      .where('id', older.id)
      .update({ created_at: new Date('2026-01-10T10:00:00.000Z') })
    await db
      .from('deliveries')
      .where('id', newer.id)
      .update({ created_at: new Date('2026-01-11T10:00:00.000Z') })

    await assert.rejects(
      () =>
        orderService.purchaseBasket(
          buyer.id,
          [
            { deliveryId: newer.id, quantity: 1 }, // tries to skip older stock
          ],
          'kiosk'
        ),
      'FIFO_VIOLATION'
    )
  })

  test('single purchase always sells from the oldest lot (strict FIFO)', async ({ assert }) => {
    const { buyer, older, newer } = await twoLots({ olderPrice: 20, newerPrice: 20 })

    // The client names the newer lot (e.g. a stale page) — the older one is sold anyway.
    const order = await orderService.purchase(buyer.id, newer.id, 'web')

    assert.equal(order.deliveryId, older.id)
    assert.equal(order.unitPrice, 20)
    await older.refresh()
    await newer.refresh()
    assert.equal(older.amountLeft, 1)
    assert.equal(newer.amountLeft, 3)
  })

  test('a cheaper newer lot cannot jump the queue', async ({ assert }) => {
    const { buyer, older, newer } = await twoLots({ olderPrice: 20, newerPrice: 12 })

    await assert.rejects(() => orderService.purchase(buyer.id, newer.id, 'web'), 'PRICE_CHANGED')

    await older.refresh()
    await newer.refresh()
    assert.equal(older.amountLeft, 2)
    assert.equal(newer.amountLeft, 3)
    assert.lengthOf(await Order.all(), 0)
  })

  test('once the oldest lot is sold out the next one is used', async ({ assert }) => {
    const { buyer, older, newer } = await twoLots({ olderPrice: 20, newerPrice: 20 })

    const first = await orderService.purchase(buyer.id, older.id, 'web')
    const second = await orderService.purchase(buyer.id, older.id, 'web')
    const third = await orderService.purchase(buyer.id, older.id, 'web')

    assert.deepEqual(
      [first.deliveryId, second.deliveryId, third.deliveryId],
      [older.id, older.id, newer.id]
    )
  })

  test('getFifoLot returns the oldest in-stock lot', async ({ assert }) => {
    const { older, newer } = await twoLots({ olderPrice: 20, newerPrice: 12 })

    const first = await orderService.getFifoLot(older.productId)
    assert.equal(first?.id, older.id)
    await older.merge({ amountLeft: 0 }).save()
    const next = await orderService.getFifoLot(older.productId)
    assert.equal(next?.id, newer.id)
  })

  test('a price corrected on the lot the buyer saw is not charged silently', async ({ assert }) => {
    const { buyer, older } = await twoLots({ olderPrice: 20, newerPrice: 20 })
    await older.merge({ price: 35 }).save()

    // Same lot as shown, but it no longer costs what the buyer confirmed.
    await assert.rejects(
      () => orderService.purchase(buyer.id, older.id, 'web', 20),
      'PRICE_CHANGED'
    )
    const order = await orderService.purchase(buyer.id, older.id, 'web', 35)
    assert.equal(order.unitPrice, 35)
  })

  test('a basket built at an old price is refused and nothing is bought', async ({ assert }) => {
    const { buyer, older } = await twoLots({ olderPrice: 20, newerPrice: 20 })
    await older.merge({ price: 25 }).save()

    await assert.rejects(
      () =>
        orderService.purchaseBasket(
          buyer.id,
          [{ deliveryId: older.id, quantity: 1, expectedPrice: 20 }],
          'kiosk'
        ),
      'PRICE_CHANGED'
    )
    assert.lengthOf(await Order.all(), 0)
    await older.refresh()
    assert.equal(older.amountLeft, 2)
  })

  test('concurrent single purchases and a basket on one product never deadlock', async ({
    assert,
  }) => {
    const { buyer, older, newer } = await twoLots({ olderPrice: 20, newerPrice: 20 })

    const results = await Promise.allSettled([
      orderService.purchase(buyer.id, older.id, 'web', 20),
      orderService.purchaseBasket(
        buyer.id,
        [{ deliveryId: older.id, quantity: 1, expectedPrice: 20 }],
        'kiosk'
      ),
      orderService.purchase(buyer.id, newer.id, 'web', 20),
    ])

    for (const result of results) {
      if (result.status === 'rejected') {
        // FIFO / stock errors are fine under contention — a deadlock is not.
        assert.notInclude(String(result.reason), 'deadlock')
      }
    }
  })
})

async function twoLots(prices: { olderPrice: number; newerPrice: number }) {
  const buyer = await UserFactory.create()
  const supplier = await UserFactory.apply('supplier').create()
  const category = await CategoryFactory.create()
  const product = await ProductFactory.merge({ categoryId: category.id }).create()
  const older = await DeliveryFactory.merge({
    supplierId: supplier.id,
    productId: product.id,
    amountSupplied: 2,
    amountLeft: 2,
    price: prices.olderPrice,
  }).create()
  const newer = await DeliveryFactory.merge({
    supplierId: supplier.id,
    productId: product.id,
    amountSupplied: 3,
    amountLeft: 3,
    price: prices.newerPrice,
  }).create()
  await db
    .from('deliveries')
    .where('id', older.id)
    .update({ created_at: new Date('2026-01-10T10:00:00.000Z') })
  await db
    .from('deliveries')
    .where('id', newer.id)
    .update({ created_at: new Date('2026-01-11T10:00:00.000Z') })
  return { buyer, supplier, product, older, newer }
}
