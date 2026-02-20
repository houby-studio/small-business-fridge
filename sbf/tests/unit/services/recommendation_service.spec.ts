import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import RecommendationService from '#services/recommendation_service'
import db from '@adonisjs/lucid/services/db'

const service = new RecommendationService()

const cleanAll = async () => {
  await db.from('recommendations').delete()
  await db.from('orders').delete()
  await db.from('deliveries').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('users').delete()
}

/** Insert orders without an invoice (correct schema: no price column). */
function orderRow(buyerId: number, deliveryId: number) {
  const now = new Date()
  return {
    buyer_id: buyerId,
    delivery_id: deliveryId,
    channel: 'web',
    created_at: now,
    updated_at: now,
  }
}

test.group('RecommendationService.computeForUser', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('returns empty array when user has no orders', async ({ assert }) => {
    const user = await UserFactory.create()
    const result = await service.computeForUser(user.id)
    assert.deepEqual(result, [])
  })

  test('returns scored products in descending score order', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()

    const productA = await ProductFactory.merge({ categoryId: category.id }).create()
    const productB = await ProductFactory.merge({ categoryId: category.id }).create()

    const deliveryA = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: productA.id,
      amountLeft: 5,
      price: 10,
    }).create()
    const deliveryB = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: productB.id,
      amountLeft: 5,
      price: 10,
    }).create()

    // productA: 3 orders, productB: 1 order — A should score higher on frequency
    await db
      .table('orders')
      .insert([
        orderRow(buyer.id, deliveryA.id),
        orderRow(buyer.id, deliveryA.id),
        orderRow(buyer.id, deliveryA.id),
        orderRow(buyer.id, deliveryB.id),
      ])

    const result = await service.computeForUser(buyer.id)

    assert.isAbove(result.length, 0)
    // First result should be productA (more orders)
    assert.equal(result[0].productId, productA.id)
    // Scores should be in descending order
    for (let i = 1; i < result.length; i++) {
      assert.isAtMost(result[i].score, result[i - 1].score)
    }
  })

  test('scores are between 0 and 1', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 5,
      price: 10,
    }).create()

    await db.table('orders').insert(orderRow(buyer.id, delivery.id))

    const result = await service.computeForUser(buyer.id)

    assert.lengthOf(result, 1)
    assert.isAtLeast(result[0].score, 0)
    assert.isAtMost(result[0].score, 1)
  })

  test('excludes out-of-stock products', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()

    const inStockProduct = await ProductFactory.merge({ categoryId: category.id }).create()
    const outOfStockProduct = await ProductFactory.merge({ categoryId: category.id }).create()

    const inStockDelivery = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: inStockProduct.id,
      amountLeft: 5,
      price: 10,
    }).create()
    const outOfStockDelivery = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: outOfStockProduct.id,
      amountLeft: 0,
      amountSupplied: 5,
      price: 10,
    }).create()

    await db
      .table('orders')
      .insert([orderRow(buyer.id, inStockDelivery.id), orderRow(buyer.id, outOfStockDelivery.id)])

    const result = await service.computeForUser(buyer.id)

    const productIds = result.map((r) => r.productId)
    assert.include(productIds, inStockProduct.id)
    assert.notInclude(productIds, outOfStockProduct.id)
  })
})

test.group('RecommendationService.getForUser', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('returns empty array when user has no history and no precomputed rows', async ({
    assert,
  }) => {
    const user = await UserFactory.create()
    const result = await service.getForUser(user.id)
    assert.deepEqual(result, [])
  })

  test('returns products in ShopProduct shape', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 5,
      price: 20,
    }).create()

    await db.table('orders').insert(orderRow(buyer.id, delivery.id))

    const result = await service.getForUser(buyer.id)

    assert.lengthOf(result, 1)
    const rec = result[0]
    assert.equal(rec.id, product.id)
    assert.equal(rec.displayName, product.displayName)
    assert.equal(rec.stockSum, 5)
    assert.equal(rec.price, 20)
    assert.isFalse(rec.isFavorite)
    assert.isObject(rec.category)
    assert.equal(rec.category.id, category.id)
  })
})
