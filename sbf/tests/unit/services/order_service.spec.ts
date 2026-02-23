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
    assert.equal(result.stats.totalUnpaid, 45) // none invoiced
    assert.lengthOf(result.orders.toJSON().data, 3)
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
})
