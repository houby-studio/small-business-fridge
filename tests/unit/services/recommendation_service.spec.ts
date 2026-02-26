import '#tests/test_context'
import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Allergen from '#models/allergen'
import RecommendationService from '#services/recommendation_service'
import db from '@adonisjs/lucid/services/db'

const cleanAll = async () => {
  await db.from('recommendations').delete()
  await db.from('orders').delete()
  await db.from('deliveries').delete()
  await db.from('product_allergen').delete()
  await db.from('products').delete()
  await db.from('allergens').delete()
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
  group.each.setup(() => {
    return {
      service: new RecommendationService(),
    }
  })
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

  test('excludes products that match user excluded allergens', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const excludedAllergen = await Allergen.create({ name: 'Gluten', isDisabled: false })

    // Associate the excluded allergen with the buyer so that computeForUser
    // reads the user's stored exclusions instead of relying on a direct argument.
    // Assuming the User model has a field to store excluded allergen IDs.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    buyer.excludedAllergenIds = [excludedAllergen.id]
    await buyer.save()

    const allowedProduct = await ProductFactory.merge({ categoryId: category.id }).create()
    const excludedProduct = await ProductFactory.merge({ categoryId: category.id }).create()

    await db.table('product_allergen').insert({
      product_id: excludedProduct.id,
      allergen_id: excludedAllergen.id,
    })

    const allowedDelivery = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: allowedProduct.id,
      amountLeft: 5,
      price: 10,
    }).create()
    const excludedDelivery = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: excludedProduct.id,
      amountLeft: 5,
      price: 10,
    }).create()

    await db
      .table('orders')
      .insert([orderRow(buyer.id, allowedDelivery.id), orderRow(buyer.id, excludedDelivery.id)])

    const result = await service.computeForUser(buyer.id)
    const productIds = result.map((r) => r.productId)

    assert.include(productIds, allowedProduct.id)
    assert.notInclude(productIds, excludedProduct.id)
  })
})

test.group('RecommendationService.getRecommendedIds', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('returns empty array when user has no history and no precomputed rows', async ({
    assert,
  }) => {
    const user = await UserFactory.create()
    const result = await service.getRecommendedIds(user.id)
    assert.deepEqual(result, [])
  })

  test('returns product IDs as number array', async ({ assert }) => {
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

    const result = await service.getRecommendedIds(buyer.id)

    assert.isArray(result)
    assert.isAbove(result.length, 0)
    assert.include(result, product.id)
    result.forEach((id) => assert.isNumber(id))
  })

  test('skips out-of-stock precomputed rows and backfills from lower ranks', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()

    const productRank1 = await ProductFactory.merge({ categoryId: category.id }).create()
    const productRank2 = await ProductFactory.merge({ categoryId: category.id }).create()
    const productRank3 = await ProductFactory.merge({ categoryId: category.id }).create()

    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: productRank1.id,
      amountLeft: 0,
      amountSupplied: 5,
      price: 20,
    }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: productRank2.id,
      amountLeft: 5,
      price: 20,
    }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: productRank3.id,
      amountLeft: 5,
      price: 20,
    }).create()

    const now = new Date()
    await db.table('recommendations').insert([
      {
        user_id: buyer.id,
        product_id: productRank1.id,
        score: 0.9,
        model: 'statistical',
        rank: 1,
        generated_at: now,
        created_at: now,
      },
      {
        user_id: buyer.id,
        product_id: productRank2.id,
        score: 0.8,
        model: 'statistical',
        rank: 2,
        generated_at: now,
        created_at: now,
      },
      {
        user_id: buyer.id,
        product_id: productRank3.id,
        score: 0.7,
        model: 'statistical',
        rank: 3,
        generated_at: now,
        created_at: now,
      },
    ])

    const result = await service.getRecommendedIds(buyer.id, 2)

    assert.deepEqual(result, [productRank2.id, productRank3.id])
    assert.notInclude(result, productRank1.id)
  })

  test('skips precomputed rows that contain user excluded allergens', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const excludedAllergen = await Allergen.create({ name: 'Milk', isDisabled: false })

    const blockedProduct = await ProductFactory.merge({ categoryId: category.id }).create()
    const allowedProduct = await ProductFactory.merge({ categoryId: category.id }).create()

    await db.table('product_allergen').insert({
      product_id: blockedProduct.id,
      allergen_id: excludedAllergen.id,
    })

    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: blockedProduct.id,
      amountLeft: 5,
      price: 20,
    }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: allowedProduct.id,
      amountLeft: 5,
      price: 20,
    }).create()

    await buyer.related('excludedAllergens').sync([excludedAllergen.id])

    const now = new Date()
    await db.table('recommendations').insert([
      {
        user_id: buyer.id,
        product_id: blockedProduct.id,
        score: 0.9,
        model: 'statistical',
        rank: 1,
        generated_at: now,
        created_at: now,
      },
      {
        user_id: buyer.id,
        product_id: allowedProduct.id,
        score: 0.8,
        model: 'statistical',
        rank: 2,
        generated_at: now,
        created_at: now,
      },
    ])

    const result = await service.getRecommendedIds(buyer.id, 2)
    assert.deepEqual(result, [allowedProduct.id])
    assert.notInclude(result, blockedProduct.id)
  })
})
