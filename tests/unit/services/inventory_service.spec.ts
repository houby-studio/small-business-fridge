import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Delivery from '#models/delivery'
import Order from '#models/order'
import StockAdjustment from '#models/stock_adjustment'
import InventoryCountItem from '#models/inventory_count_item'
import InventoryService from '#services/inventory_service'
import AdminService from '#services/admin_service'
import mail from '@adonisjs/mail/services/main'
import FinanceService from '#services/finance_service'
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
  options: {
    left?: number
    price?: number
    purchasePrice?: number | null
    createdAt?: DateTime
  } = {}
) {
  return Delivery.create({
    supplierId,
    productId,
    amountSupplied: amount,
    amountLeft: options.left ?? amount,
    amountLost: 0,
    price: options.price ?? 15,
    purchasePrice: options.purchasePrice ?? null,
    createdAt: options.createdAt ?? DateTime.now().minus({ days: daysAgo }),
  })
}

/** One piece of `delivery` bought by `buyerId` at `at` — the stock goes down with it. */
async function sold(delivery: Delivery, buyerId: number, at: DateTime) {
  await Order.create({
    buyerId,
    deliveryId: delivery.id,
    channel: 'web',
    unitPrice: delivery.price,
    createdAt: at,
  })
  await Delivery.query().where('id', delivery.id).decrement('amountLeft', 1)
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
      'DELIVERY_HAS_ADJUSTMENTS'
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

  test('a sale between loading the sheet and counting is not shrinkage (BE-01)', async ({
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const only = await lot(supplier.id, product.id, 3, 5)
    const sheetLoaded = DateTime.now().minus({ minutes: 10 })
    // A colleague buys one while the supplier walks to the fridge; the shelf then has 4.
    await sold(only, buyer.id, DateTime.now().minus({ minutes: 5 }))

    await service.commitCount(supplier, {
      scope: 'all',
      items: [
        {
          productId: product.id,
          expected: 5,
          counted: 4,
          asOf: sheetLoaded.toJSDate(),
          countedAt: DateTime.now().minus({ minutes: 2 }).toJSDate(),
        },
      ],
    })

    assert.equal(await leftOf(only.id), 4)
    assert.lengthOf(await StockAdjustment.all(), 0)
    const [item] = await InventoryCountItem.all()
    assert.equal(item.expectedQty, 4)
    assert.equal(item.sheetQty, 5)
  })

  test('only what moved before the product was counted shifts the expected stock', async ({
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const mine = await lot(supplier.id, product.id, 3, 5)
    const sheetLoaded = DateTime.now().minus({ minutes: 20 })
    const countedAt = DateTime.now().minus({ minutes: 5 })
    // Before counting: a colleague stocked 6 and one piece broke; after counting: a sale.
    await lot(colleague.id, product.id, 0, 6, { createdAt: DateTime.now().minus({ minutes: 15 }) })
    await service.writeOff(colleague, { productId: product.id, quantity: 1, reason: 'damaged' })
    await db
      .from('stock_adjustments')
      .update({ created_at: DateTime.now().minus({ minutes: 12 }).toJSDate() })
    await sold(mine, buyer.id, DateTime.now().minus({ minutes: 1 }))

    // Shelf at counting: 5 + 6 − 1 = 10, and the supplier counts 9 → one piece is missing.
    await service.commitCount(supplier, {
      scope: 'all',
      items: [
        {
          productId: product.id,
          expected: 5,
          counted: 9,
          asOf: sheetLoaded.toJSDate(),
          countedAt: countedAt.toJSDate(),
        },
      ],
    })

    const [item] = await InventoryCountItem.all()
    assert.equal(item.expectedQty, 10)
    assert.equal(item.appliedQty, -1)
  })

  test('a purchase cancelled while counting is not found again as a surplus', async ({
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const admin = await UserFactory.apply('admin').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const only = await lot(me.id, product.id, 3, 6)
    // Bought by mistake (the piece never left the shelf) before the sheet was loaded…
    await sold(only, buyer.id, DateTime.now().minus({ minutes: 20 }))
    const [mistake] = await Order.query().where('deliveryId', only.id)
    // …and cancelled after the product was counted: system 6 = shelf 6.
    mail.fake()
    await new AdminService().stornoOrder(mistake.id, admin.id)
    mail.restore()

    await service.commitCount(me, {
      scope: 'all',
      items: [
        {
          productId: product.id,
          expected: 5,
          counted: 6,
          asOf: DateTime.now().minus({ minutes: 10 }).toJSDate(),
          countedAt: DateTime.now().minus({ minutes: 2 }).toJSDate(),
        },
      ],
    })
    assert.equal(await leftOf(only.id), 6)
    assert.lengthOf(await StockAdjustment.all(), 0)
  })

  test('a write-off reverted while counting is not found again as a surplus', async ({
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const only = await lot(me.id, product.id, 3, 6)
    const [row] = await service.writeOff(me, {
      productId: product.id,
      quantity: 2,
      reason: 'expired',
    })
    await db
      .from('stock_adjustments')
      .where('id', row.id)
      .update({ created_at: DateTime.now().minus({ minutes: 60 }).toJSDate() })
    await service.revertWriteOff(me, row.id)

    await service.commitCount(me, {
      scope: 'all',
      items: [
        {
          productId: product.id,
          expected: 4,
          counted: 6,
          asOf: DateTime.now().minus({ minutes: 10 }).toJSDate(),
          countedAt: DateTime.now().minus({ minutes: 2 }).toJSDate(),
        },
      ],
    })
    assert.equal(await leftOf(only.id), 6)
    assert.equal(await lostOf(only.id), 0)
  })

  test('a write-off made and reverted while counting cancels out', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const only = await lot(me.id, product.id, 3, 6)
    const asOf = DateTime.now().minus({ minutes: 10 }).toJSDate()
    const [row] = await service.writeOff(me, {
      productId: product.id,
      quantity: 1,
      reason: 'damaged',
    })
    await service.revertWriteOff(me, row.id)

    await service.commitCount(me, {
      scope: 'all',
      items: [{ productId: product.id, expected: 6, counted: 6, asOf, countedAt: new Date() }],
    })
    assert.equal(await leftOf(only.id), 6)
    assert.equal(await lostOf(only.id), 0)
  })

  test('two inventories of the same product do not write the shortfall off twice', async ({
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const only = await lot(me.id, product.id, 3, 6)
    const bothLoaded = DateTime.now().minus({ minutes: 10 })

    // Both see 6 and count 5; the colleague saves first.
    const input = {
      productId: product.id,
      expected: 6,
      counted: 5,
      asOf: bothLoaded.toJSDate(),
      countedAt: DateTime.now().minus({ minutes: 5 }).toJSDate(),
    }
    await service.commitCount(colleague, { scope: 'all', items: [input] })
    await service.commitCount(me, { scope: 'all', items: [input] })

    assert.equal(await leftOf(only.id), 5)
    assert.equal(await lostOf(only.id), 1)
  })

  test('without "expected" the current stock of the whole fridge is compared', async ({
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await lot(me.id, product.id, 3, 4)
    await lot(colleague.id, product.id, 2, 3)

    await service.commitCount(me, {
      scope: 'mine',
      items: [{ productId: product.id, counted: 6 }],
    })
    const [item] = await InventoryCountItem.all()
    assert.equal(item.expectedQty, 7)
    assert.equal(item.appliedQty, -1)
  })

  test('a surplus prefers a lot something already left over an untouched one (PRO-19)', async ({
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const older = await lot(me.id, product.id, 5, 6, { left: 2 })
    const untouched = await lot(me.id, product.id, 1, 6)

    await service.commitCount(me, {
      scope: 'mine',
      items: [{ productId: product.id, expected: 8, counted: 9 }],
    })

    assert.equal(await leftOf(older.id), 3)
    assert.equal(await leftOf(untouched.id), 6)
    const fresh1 = await fresh(untouched.id)
    assert.isAtMost(fresh1.amountLeft, fresh1.amountSupplied)
  })

  test('the commit is audited with the loss at purchase prices, inside the transaction', async ({
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await lot(me.id, product.id, 5, 2, { price: 20, purchasePrice: 12.5 })
    await lot(me.id, product.id, 1, 2, { price: 20 })

    await service.commitCount(me, {
      scope: 'mine',
      items: [{ productId: product.id, expected: 4, counted: 1 }],
    })
    const audit = await db.from('audit_logs').where('action', 'inventory.committed').first()
    assert.equal(audit.metadata.lossValue, 60)
    // 2 × 12,50 known + 1 × 20 (no purchase price, valued at selling price)
    assert.equal(audit.metadata.lossCost, 45)
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

  test('"mine" offers the products the supplier has in stock or delivered lately', async ({
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const mine = await ProductFactory.merge({ categoryId: category.id }).create()
    const theirs = await ProductFactory.merge({ categoryId: category.id }).create()
    const soldOut = await ProductFactory.merge({ categoryId: category.id }).create()
    const longGone = await ProductFactory.merge({ categoryId: category.id }).create()
    const theirsEmptyForMe = await ProductFactory.merge({ categoryId: category.id }).create()
    await lot(me.id, mine.id, 1, 3)
    await lot(colleague.id, mine.id, 1, 2)
    await lot(colleague.id, theirs.id, 1, 3)
    // Sold out last week: the system says 0, but the shelf may still hold a piece.
    await lot(me.id, soldOut.id, 7, 3, { left: 0 })
    await lot(me.id, longGone.id, 120, 3, { left: 0 })
    // My lot there is old and empty, a colleague's is full — not "mine" any more.
    await lot(me.id, theirsEmptyForMe.id, 120, 3, { left: 0 })
    await lot(colleague.id, theirsEmptyForMe.id, 1, 3)

    const own = await service.getCountableProducts(me, 'mine')
    assert.sameDeepMembers(
      own.map((p) => [p.productId, p.stock]),
      [
        [mine.id, 5],
        [soldOut.id, 0],
      ]
    )
    const all = await service.getCountableProducts(me, 'all')
    assert.sameMembers(
      all.map((p) => p.productId),
      [mine.id, theirs.id, soldOut.id, theirsEmptyForMe.id]
    )
  })

  test('the sheet runs by category, then by name, both in Czech order (P3)', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const sweets = await CategoryFactory.merge({ name: 'Sladkosti' }).create()
    const drinks = await CategoryFactory.merge({ name: 'Nealko' }).create()
    const food = await CategoryFactory.merge({ name: 'Čerstvé' }).create()
    const names: Array<[number, string]> = [
      [sweets.id, 'Tatranka'],
      [drinks.id, 'Čaj ledový'],
      [drinks.id, 'Cola'],
      [sweets.id, 'Bounty'],
      [drinks.id, 'Zázvorka'],
      [food.id, 'Rohlík'],
    ]
    for (const [categoryId, displayName] of names) {
      const product = await ProductFactory.merge({ categoryId, displayName }).create()
      // A sold-out product keeps its place in the order.
      await lot(me.id, product.id, 2, 3, { left: displayName === 'Cola' ? 0 : 3 })
    }

    const sheet = await service.getCountableProducts(me, 'all')
    assert.deepEqual(
      sheet.map((p) => [p.categoryName, p.productName]),
      [
        ['Čerstvé', 'Rohlík'],
        ['Nealko', 'Cola'],
        ['Nealko', 'Čaj ledový'],
        ['Nealko', 'Zázvorka'],
        ['Sladkosti', 'Bounty'],
        ['Sladkosti', 'Tatranka'],
      ]
    )
  })

  test('an archived product is not on the sheet (F6)', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await lot(me.id, product.id, 7, 3, { left: 0 })
    assert.lengthOf(await service.getCountableProducts(me, 'all'), 1)

    product.archivedAt = DateTime.now()
    await product.save()
    assert.lengthOf(await service.getCountableProducts(me, 'all'), 0)
  })

  test('a product the system has at zero can be counted back into stock', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const only = await lot(me.id, product.id, 7, 3, { left: 0 })

    await service.commitCount(me, {
      scope: 'mine',
      items: [{ productId: product.id, expected: 0, counted: 2 }],
    })
    assert.equal(await leftOf(only.id), 2)
    assert.equal(await lostOf(only.id), -2)
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

test.group('InventoryService — a handover committing while waiting for the lots', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  /**
   * Plays a handover in an open transaction holding the lot's lock: the original lot gives
   * its stock to a new lot of the heir. Whatever starts before `trx.commit()` waits for it.
   */
  async function duringHandover() {
    const leaver = await UserFactory.apply('supplier').create()
    const heir = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const original = await lot(leaver.id, product.id, 5, 4)

    const trx = await db.transaction()
    await trx.from('deliveries').where('id', original.id).forUpdate().first()
    await trx
      .from('deliveries')
      .where('id', original.id)
      .update({ amount_supplied: 0, amount_left: 0 })
    const [heirLot] = await trx
      .table('deliveries')
      .insert({
        supplier_id: heir.id,
        product_id: product.id,
        amount_supplied: 4,
        amount_left: 4,
        amount_lost: 0,
        price: 15,
        transferred_from_id: original.id,
        created_at: original.createdAt.toJSDate(),
        updated_at: new Date(),
      })
      .returning('id')
    return { product, heir, heirLotId: Number(heirLot.id ?? heirLot), trx }
  }

  test('a write-off waiting for a handover finds the heir’s lot', async ({ assert }) => {
    const ctx = await duringHandover()
    const actor = await UserFactory.apply('admin').create()
    const pending = service.writeOff(actor, {
      productId: ctx.product.id,
      quantity: 1,
      reason: 'damaged',
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await ctx.trx.commit()

    const [row] = await pending
    assert.equal(row.deliveryId, ctx.heirLotId)
    assert.equal(await leftOf(ctx.heirLotId), 3)
  })

  test('an inventory waiting for a handover compares with the stock after it', async ({
    assert,
  }) => {
    const ctx = await duringHandover()
    const pending = service.commitCount(ctx.heir, {
      scope: 'all',
      items: [{ productId: ctx.product.id, counted: 4 }],
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await ctx.trx.commit()

    await pending
    const [item] = await InventoryCountItem.all()
    assert.equal(item.expectedQty, 4)
    assert.equal(item.appliedQty, 0)
    assert.lengthOf(await StockAdjustment.all(), 0)
  })
})

test.group('InventoryService.revertWriteOff', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  async function writtenOff(daysAgo = 0) {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const old = await lot(supplier.id, product.id, 10, 2, { purchasePrice: 10 })
    const newer = await lot(supplier.id, product.id, 2, 5, { purchasePrice: 12 })
    const rows = await service.writeOff(supplier, {
      productId: product.id,
      quantity: 3,
      reason: 'damaged',
    })
    if (daysAgo) {
      await db
        .from('stock_adjustments')
        .update({ created_at: DateTime.now().minus({ days: daysAgo }).toJSDate() })
    }
    return { supplier, product, old, newer, rows }
  }

  test('the pieces go back onto the very lot and the row is marked, not deleted', async ({
    assert,
  }) => {
    const { supplier, old, newer, rows } = await writtenOff()
    // FIFO took 2 off the old lot and 1 off the newer one; revert the newer lot's piece.
    const onNewer = rows.find((row) => row.deliveryId === newer.id)!

    await service.revertWriteOff(supplier, onNewer.id)

    assert.equal(await leftOf(newer.id), 5)
    assert.equal(await lostOf(newer.id), 0)
    assert.equal(await leftOf(old.id), 0)
    assert.equal(await lostOf(old.id), 2)
    const row = await StockAdjustment.findOrFail(onNewer.id)
    assert.isNotNull(row.revertedAt)
    assert.equal(row.revertedBy, supplier.id)
    const audit = await db.from('audit_logs').where('action', 'stock.write_off_reverted').first()
    assert.equal(audit.entity_id, onNewer.id)
    assert.equal(audit.metadata.quantity, 1)

    await assert.rejects(() => service.revertWriteOff(supplier, onNewer.id), 'ALREADY_REVERTED')
  })

  test('only the author or an admin, within 7 days, a live lot and a write-off', async ({
    assert,
  }) => {
    const { rows } = await writtenOff()
    const colleague = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    await assert.rejects(() => service.revertWriteOff(colleague, rows[0].id), 'FORBIDDEN')
    await service.revertWriteOff(admin, rows[0].id)
    await assert.rejects(() => service.revertWriteOff(admin, 999_999), 'ADJUSTMENT_NOT_FOUND')

    const late = await writtenOff(8)
    await assert.rejects(
      () => service.revertWriteOff(late.supplier, late.rows[0].id),
      'REVERT_TOO_LATE'
    )

    const voided = await writtenOff()
    await Delivery.query()
      .where('id', voided.rows[0].deliveryId)
      .update({ voidedAt: DateTime.now().toJSDate() })
    await assert.rejects(
      () => service.revertWriteOff(voided.supplier, voided.rows[0].id),
      'DELIVERY_VOIDED'
    )

    // An inventory difference is not a write-off — the next inventory corrects it.
    const counted = await writtenOff()
    const count = await service.commitCount(counted.supplier, {
      scope: 'mine',
      items: [{ productId: counted.product.id, expected: 4, counted: 3 }],
    })
    const [inventoryRow] = await StockAdjustment.query().where('inventoryCountId', count.id)
    await assert.rejects(
      () => service.revertWriteOff(counted.supplier, inventoryRow.id),
      'NOT_A_WRITE_OFF'
    )
  })

  test('after a handover the reverted pieces belong to the heir, as nobody’s shrinkage', async ({
    assert,
  }) => {
    const leaver = await UserFactory.apply('supplier').create()
    const heir = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const original = await lot(leaver.id, product.id, 10, 6, { purchasePrice: 10 })
    const [row] = await service.writeOff(leaver, {
      productId: product.id,
      quantity: 2,
      reason: 'expired',
    })
    const { lots } = await new DeliveryService().transferStock(leaver.id, heir.id, admin)
    const heirLotId = lots[0].toDeliveryId

    await service.revertWriteOff(leaver, row.id)

    const before = await fresh(original.id)
    const after = await fresh(heirLotId)
    assert.deepEqual([before.amountSupplied, before.amountLeft, before.amountLost], [0, 0, 0])
    assert.deepEqual([after.amountSupplied, after.amountLeft, after.amountLost], [6, 6, 0])
    // supplied = left + sold + lost on both lots (nothing sold here).
    for (const l of [before, after]) {
      assert.equal(l.amountSupplied, l.amountLeft + l.amountLost)
    }
    const finance = new FinanceService()
    for (const supplier of [leaver, heir]) {
      const summary = await finance.getSummary(supplier.id, DateTime.now().year, 0)
      assert.equal(summary.shrinkage.lostUnits, 0)
    }
    const audit = await db.from('audit_logs').where('action', 'stock.write_off_reverted').first()
    assert.equal(audit.metadata.returnedToDeliveryId, heirLotId)
  })

  test('a reverted write-off is no shrinkage in the earnings', async ({ assert }) => {
    const { supplier, rows } = await writtenOff()
    for (const row of rows) await service.revertWriteOff(supplier, row.id)
    const summary = await new FinanceService().getSummary(supplier.id, DateTime.now().year, 0)
    assert.equal(summary.shrinkage.lostUnits, 0)
    assert.equal(summary.shrinkage.lossCost, 0)
    assert.deepEqual(summary.shrinkage.byReason, [])
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
