import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Delivery from '#models/delivery'
import StockAdjustment from '#models/stock_adjustment'
import InventoryCountItem from '#models/inventory_count_item'
import InventoryService from '#services/inventory_service'
import DeliveryService from '#services/delivery_service'
import InventoryCount from '#models/inventory_count'

const service = new InventoryService()

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

async function lot(
  supplierId: number,
  productId: number,
  daysAgo: number,
  amount: number,
  options: { left?: number; price?: number; purchasePrice?: number | null } = {}
) {
  return Delivery.create({
    supplierId,
    productId,
    amountSupplied: amount,
    amountLeft: options.left ?? amount,
    amountLost: 0,
    price: options.price ?? 15,
    purchasePrice: options.purchasePrice ?? null,
    createdAt: DateTime.now().minus({ days: daysAgo }),
  })
}

async function fresh(id: number) {
  return Delivery.findOrFail(id)
}

async function leftOf(id: number) {
  const delivery = await fresh(id)
  return delivery.amountLeft
}

async function lostOf(id: number) {
  const delivery = await fresh(id)
  return delivery.amountLost
}

test.group('InventoryService.writeOff', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('takes pieces off the oldest lots first and snapshots their prices', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const old = await lot(supplier.id, product.id, 10, 6, {
      left: 2,
      price: 14,
      purchasePrice: 12.9,
    })
    const newer = await lot(supplier.id, product.id, 2, 6, { price: 16, purchasePrice: 14.9 })

    const adjustments = await service.writeOff(supplier, {
      productId: product.id,
      quantity: 3,
      reason: 'expired',
      note: 'prošlé jogurty',
    })

    assert.lengthOf(adjustments, 2)
    const oldAfter = await fresh(old.id)
    const newerAfter = await fresh(newer.id)
    assert.equal(oldAfter.amountLeft, 0)
    assert.equal(oldAfter.amountLost, 2)
    assert.equal(newerAfter.amountLeft, 5)
    assert.equal(newerAfter.amountLost, 1)
    // What was sold stays what it was: supplied - left - lost.
    assert.equal(oldAfter.amountSupplied - oldAfter.amountLeft - oldAfter.amountLost, 4)

    const rows = await StockAdjustment.query().orderBy('id', 'asc')
    assert.deepEqual(
      rows.map((r) => [r.deliveryId, r.kind, r.reason, r.quantity, r.unitCost, r.unitPrice]),
      [
        [old.id, 'loss', 'expired', 2, 12.9, 14],
        [newer.id, 'loss', 'expired', 1, 14.9, 16],
      ]
    )
    assert.equal(rows[0].note, 'prošlé jogurty')

    const audit = await db.from('audit_logs').where('action', 'stock.written_off')
    assert.lengthOf(audit, 1)
  })

  test('refuses to write off more than is in stock', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const only = await lot(supplier.id, product.id, 1, 4, { left: 2 })

    await assert.rejects(
      () => service.writeOff(supplier, { productId: product.id, quantity: 3, reason: 'damaged' }),
      'NOT_ENOUGH_STOCK'
    )
    assert.equal(await leftOf(only.id), 2)
    assert.lengthOf(await StockAdjustment.all(), 0)
  })

  test('a loss on a colleague’s lot is logged for them', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await lot(colleague.id, product.id, 5, 3)
    await lot(me.id, product.id, 1, 3)

    const [adjustment] = await service.writeOff(me, {
      productId: product.id,
      quantity: 1,
      reason: 'other',
    })
    assert.equal(adjustment.supplierId, colleague.id)
    assert.equal(adjustment.actorId, me.id)

    const audit = await db.from('audit_logs').where('action', 'stock.written_off').first()
    assert.equal(audit.target_user_id, colleague.id)
  })

  test('a written-off lot can no longer be voided, nor corrected below what is gone', async ({
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const only = await lot(supplier.id, product.id, 1, 5)
    await service.writeOff(supplier, { productId: product.id, quantity: 2, reason: 'damaged' })

    const deliveries = new DeliveryService()
    await assert.rejects(
      () => deliveries.voidDelivery(supplier, only.id, 'omyl'),
      'DELIVERY_HAS_ORDERS'
    )
    await assert.rejects(
      () =>
        deliveries.correctDelivery(supplier, only.id, { amount: 1, price: 15, reason: 'oprava' }),
      'AMOUNT_BELOW_SOLD'
    )
    const corrected = await deliveries.correctDelivery(supplier, only.id, {
      amount: 4,
      price: 15,
      reason: 'oprava',
    })
    assert.equal(corrected.delivery.amountLeft, 2)
  })
})

test.group('InventoryService.commitCount', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('missing pieces are written off FIFO, extra ones go back onto the newest lot', async ({
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const cola = await ProductFactory.merge({ categoryId: category.id }).create()
    const chips = await ProductFactory.merge({ categoryId: category.id }).create()
    const water = await ProductFactory.merge({ categoryId: category.id }).create()
    const colaOld = await lot(supplier.id, cola.id, 9, 6, { left: 1, purchasePrice: 14.9 })
    const colaNew = await lot(supplier.id, cola.id, 3, 6, { left: 6, purchasePrice: 14.9 })
    const chipsOnly = await lot(supplier.id, chips.id, 3, 10, { left: 4, price: 30 })
    await lot(supplier.id, water.id, 3, 4)

    const count = await service.commitCount(supplier, {
      scope: 'mine',
      note: 'říjen',
      items: [
        { productId: cola.id, expected: 7, counted: 5 },
        { productId: chips.id, expected: 4, counted: 5 },
        { productId: water.id, expected: 4, counted: 4 },
      ],
    })

    assert.equal(await leftOf(colaOld.id), 0)
    assert.equal(await leftOf(colaNew.id), 5)
    assert.equal(await lostOf(colaNew.id), 1)
    assert.equal(await leftOf(chipsOnly.id), 5)
    assert.equal(await lostOf(chipsOnly.id), -1)

    const items = await InventoryCountItem.query()
      .where('inventoryCountId', count.id)
      .orderBy('productId', 'asc')
    assert.deepEqual(
      items.map((i) => [i.productId, i.expectedQty, i.countedQty, i.appliedQty]),
      [
        [cola.id, 7, 5, -2],
        [chips.id, 4, 5, 1],
        [water.id, 4, 4, 0],
      ].sort((a, b) => a[0] - b[0])
    )
    const adjustments = await StockAdjustment.query().where('inventoryCountId', count.id)
    assert.lengthOf(adjustments, 3)
    assert.isTrue(adjustments.every((a) => a.reason === 'inventory'))

    const audit = await db.from('audit_logs').where('action', 'inventory.committed').first()
    assert.equal(audit.metadata.lossQuantity, 2)
    assert.equal(audit.metadata.surplusQuantity, 1)
  })

  test('sales after counting are not shrinkage', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    // Counted 10 of 10, then two sold before the count was saved: stock is now 8.
    const only = await lot(supplier.id, product.id, 1, 10, { left: 8 })

    await service.commitCount(supplier, {
      scope: 'all',
      items: [{ productId: product.id, expected: 10, counted: 10 }],
    })
    assert.equal(await leftOf(only.id), 8)
    assert.lengthOf(await StockAdjustment.all(), 0)
  })

  test('a surplus goes onto the newest lot of whoever counted', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const mineOld = await lot(me.id, product.id, 9, 6, { left: 2 })
    const mineNew = await lot(me.id, product.id, 5, 6, { left: 3 })
    const theirsNewest = await lot(colleague.id, product.id, 1, 6, { left: 4 })

    await service.commitCount(me, {
      scope: 'all',
      items: [{ productId: product.id, expected: 9, counted: 11 }],
    })

    assert.equal(await leftOf(mineOld.id), 2)
    assert.equal(await leftOf(mineNew.id), 5)
    assert.equal(await lostOf(mineNew.id), -2)
    assert.equal(await leftOf(theirsNewest.id), 4)
    const [surplus] = await StockAdjustment.query().where('kind', 'surplus')
    assert.equal(surplus.deliveryId, mineNew.id)
    assert.equal(surplus.supplierId, me.id)
    // My own lot changed — nothing to tell a colleague about.
    assert.lengthOf(await db.from('audit_logs').where('action', 'stock.adjusted'), 0)
  })

  test('without a lot of their own, a surplus goes onto the newest lot there is', async ({
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await lot(colleague.id, product.id, 9, 6, { left: 2 })
    const newest = await lot(colleague.id, product.id, 1, 6, { left: 4 })

    await service.commitCount(me, {
      scope: 'all',
      items: [{ productId: product.id, expected: 6, counted: 7 }],
    })

    assert.equal(await leftOf(newest.id), 5)
    const [surplus] = await StockAdjustment.query().where('kind', 'surplus')
    assert.equal(surplus.deliveryId, newest.id)
    const audit = await db.from('audit_logs').where('action', 'stock.adjusted').first()
    assert.equal(audit.target_user_id, colleague.id)
    assert.equal(audit.metadata.surplusQuantity, 1)
  })

  test('an empty count and unknown products are refused', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    await assert.rejects(
      () => service.commitCount(supplier, { scope: 'mine', items: [] }),
      'NOTHING_COUNTED'
    )
    await assert.rejects(
      () =>
        service.commitCount(supplier, {
          scope: 'mine',
          items: [{ productId: 999_999, expected: 1, counted: 0 }],
        }),
      'PRODUCT_NOT_FOUND'
    )
  })

  test('a stolen piece can be written off', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await lot(supplier.id, product.id, 1, 3)

    const [adjustment] = await service.writeOff(supplier, {
      productId: product.id,
      quantity: 1,
      reason: 'stolen',
    })
    assert.equal(adjustment.reason, 'stolen')
  })

  test('"mine" offers the products the supplier has in stock', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const mine = await ProductFactory.merge({ categoryId: category.id }).create()
    const theirs = await ProductFactory.merge({ categoryId: category.id }).create()
    const empty = await ProductFactory.merge({ categoryId: category.id }).create()
    await lot(me.id, mine.id, 1, 3)
    await lot(colleague.id, mine.id, 1, 2)
    await lot(colleague.id, theirs.id, 1, 3)
    await lot(me.id, empty.id, 1, 3, { left: 0 })

    const own = await service.getCountableProducts(me, 'mine')
    assert.deepEqual(
      own.map((p) => [p.productId, p.stock]),
      [[mine.id, 5]]
    )
    const all = await service.getCountableProducts(me, 'all')
    assert.sameMembers(
      all.map((p) => p.productId),
      [mine.id, theirs.id]
    )
  })

  test('past inventories can be narrowed down to the ones I counted', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await lot(me.id, product.id, 1, 5)
    const mine = await service.commitCount(me, {
      scope: 'mine',
      items: [{ productId: product.id, expected: 5, counted: 5 }],
    })
    const theirs = await service.commitCount(colleague, {
      scope: 'all',
      items: [{ productId: product.id, expected: 5, counted: 4 }],
    })

    const everyone = await service.listCounts(1, 10)
    assert.deepEqual(
      everyone.data.map((c) => c.id),
      [theirs.id, mine.id]
    )
    const own = await service.listCounts(1, 10, { actorId: me.id })
    assert.deepEqual(
      own.data.map((c) => [c.id, c.actorName, c.scope]),
      [[mine.id, me.displayName, 'mine']]
    )
    assert.equal(own.meta.total, 1)
    assert.lengthOf(await InventoryCount.all(), 2)
  })

  test('a product is counted once per inventory', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await lot(supplier.id, product.id, 1, 5)
    const count = await service.commitCount(supplier, {
      scope: 'mine',
      items: [
        { productId: product.id, expected: 5, counted: 4 },
        { productId: product.id, expected: 5, counted: 3 },
      ],
    })
    assert.lengthOf(await InventoryCountItem.query().where('inventoryCountId', count.id), 1)
    await assert.rejects(() =>
      InventoryCountItem.create({
        inventoryCountId: count.id,
        productId: product.id,
        expectedQty: 5,
        countedQty: 5,
        appliedQty: 0,
      })
    )
  })
})

test.group('InventoryService.reclassifyCountLoss', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  async function reasonsById() {
    const rows = await StockAdjustment.query().orderBy('id', 'asc')
    return new Map(rows.map((row) => [row.id, row.reason]))
  }

  test('only the loss rows of that inventory and product change, and it is audited', async ({
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const cola = await ProductFactory.merge({ categoryId: category.id }).create()
    const chips = await ProductFactory.merge({ categoryId: category.id }).create()
    await lot(colleague.id, cola.id, 9, 6, { left: 2 })
    await lot(me.id, cola.id, 3, 6, { left: 5 })
    await lot(me.id, chips.id, 3, 10, { left: 4 })

    // A write-off before the count: off the colleague's older lot, not part of any inventory.
    const [writtenOff] = await service.writeOff(me, {
      productId: cola.id,
      quantity: 1,
      reason: 'damaged',
    })
    // Two cola missing, spread FIFO over both lots; one bag of chips too many.
    const count = await service.commitCount(me, {
      scope: 'all',
      items: [
        { productId: cola.id, expected: 6, counted: 4 },
        { productId: chips.id, expected: 4, counted: 5 },
      ],
    })
    // A later inventory finds another cola missing.
    const later = await service.commitCount(me, {
      scope: 'all',
      items: [{ productId: cola.id, expected: 4, counted: 3 }],
    })
    const countLosses = await StockAdjustment.query()
      .where('inventoryCountId', count.id)
      .where('productId', cola.id)
    assert.lengthOf(countLosses, 2)
    const surplus = await StockAdjustment.query()
      .where('inventoryCountId', count.id)
      .where('kind', 'surplus')
      .firstOrFail()
    const laterLoss = await StockAdjustment.query()
      .where('inventoryCountId', later.id)
      .firstOrFail()

    const result = await service.reclassifyCountLoss(me, count.id, cola.id, 'stolen')
    assert.isTrue(result.changed)

    const reasons = await reasonsById()
    for (const row of countLosses) assert.equal(reasons.get(row.id), 'stolen')
    assert.equal(reasons.get(writtenOff.id), 'damaged')
    assert.equal(reasons.get(surplus.id), 'inventory')
    assert.equal(reasons.get(laterLoss.id), 'inventory')

    // One entry per lot owner, aimed at the colleague whose lot it was.
    const audit = await db
      .from('audit_logs')
      .where('action', 'stock.reclassified')
      .orderBy('id', 'asc')
    assert.lengthOf(audit, 2)
    assert.sameMembers(
      audit.map((entry) => entry.target_user_id),
      [colleague.id, null]
    )
    for (const entry of audit) {
      assert.equal(entry.user_id, me.id)
      assert.equal(entry.entity_type, 'inventory_count')
      assert.equal(entry.entity_id, count.id)
      assert.deepInclude(entry.metadata, {
        inventoryCountId: count.id,
        productId: cola.id,
        from: 'inventory',
        to: 'stolen',
        lossQuantity: 1,
      })
    }

    // The same reason again changes nothing and logs nothing.
    const again = await service.reclassifyCountLoss(me, count.id, cola.id, 'stolen')
    assert.isFalse(again.changed)
    const audited = await db.from('audit_logs').where('action', 'stock.reclassified')
    assert.lengthOf(audited, 2)

    // Back to "not specified" is a reclassification like any other.
    await service.reclassifyCountLoss(me, count.id, cola.id, 'inventory')
    const reverted = await reasonsById()
    for (const row of countLosses) assert.equal(reverted.get(row.id), 'inventory')
  })

  test('a surplus, an unknown inventory or a product it did not touch has nothing to classify', async ({
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const chips = await ProductFactory.merge({ categoryId: category.id }).create()
    const water = await ProductFactory.merge({ categoryId: category.id }).create()
    await lot(supplier.id, chips.id, 3, 10, { left: 4 })
    const count = await service.commitCount(supplier, {
      scope: 'mine',
      items: [{ productId: chips.id, expected: 4, counted: 5 }],
    })

    await assert.rejects(
      () => service.reclassifyCountLoss(supplier, count.id, chips.id, 'stolen'),
      'NOTHING_TO_CLASSIFY'
    )
    await assert.rejects(
      () => service.reclassifyCountLoss(supplier, count.id, water.id, 'stolen'),
      'NOTHING_TO_CLASSIFY'
    )
    await assert.rejects(
      () => service.reclassifyCountLoss(supplier, count.id + 1000, chips.id, 'stolen'),
      'NOTHING_TO_CLASSIFY'
    )
    const surplus = await StockAdjustment.query().where('inventoryCountId', count.id).firstOrFail()
    assert.equal(surplus.reason, 'inventory')
    const audit = await db.from('audit_logs').where('action', 'stock.reclassified')
    assert.lengthOf(audit, 0)
  })

  test('only the counter, an owner of a touched lot or an admin may give a reason', async ({
    assert,
  }) => {
    const counter = await UserFactory.apply('supplier').create()
    const owner = await UserFactory.apply('supplier').create()
    const bystander = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await lot(owner.id, product.id, 3, 6, { left: 4 })
    const count = await service.commitCount(counter, {
      scope: 'all',
      items: [{ productId: product.id, expected: 4, counted: 3 }],
    })
    const reasonOf = async () => {
      const row = await StockAdjustment.query().where('inventoryCountId', count.id).firstOrFail()
      return row.reason
    }

    await assert.rejects(
      () => service.reclassifyCountLoss(bystander, count.id, product.id, 'stolen'),
      'FORBIDDEN'
    )
    assert.equal(await reasonOf(), 'inventory')
    assert.lengthOf(await db.from('audit_logs').where('action', 'stock.reclassified'), 0)

    await service.reclassifyCountLoss(owner, count.id, product.id, 'damaged')
    assert.equal(await reasonOf(), 'damaged')
    await service.reclassifyCountLoss(counter, count.id, product.id, 'expired')
    assert.equal(await reasonOf(), 'expired')
    await service.reclassifyCountLoss(admin, count.id, product.id, 'stolen')
    assert.equal(await reasonOf(), 'stolen')
  })
})
