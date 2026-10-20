import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Delivery from '#models/delivery'
import Order from '#models/order'
import StockAdjustment from '#models/stock_adjustment'
import InventoryCountItem from '#models/inventory_count_item'
import InventoryService, { canRevertWriteOff } from '#services/inventory_service'
import DeliveryService from '#services/delivery_service'
import OrderService from '#services/order_service'
import AdminService from '#services/admin_service'
import InvoiceService from '#services/invoice_service'
import { assertStockInvariants } from '#tests/helpers/stock_invariants'

/**
 * Edges of the stock bookkeeping: exact boundaries (n−1, n, n+1), voided lots, inventories
 * that span sales, deliveries and other counts, reverts, handovers and the stock overview.
 * Expected numbers are worked out by hand in the comments. Every test that changes lots ends
 * with the shared invariants (I1–I7, tests/helpers/stock_invariants.ts).
 */

const inventory = new InventoryService()
const deliveries = new DeliveryService()
const orders = new OrderService()

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

async function product(displayName?: string) {
  const category = await CategoryFactory.create()
  return ProductFactory.merge({
    categoryId: category.id,
    ...(displayName && { displayName }),
  }).create()
}

async function lot(
  supplierId: number,
  productId: number,
  createdAt: DateTime,
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
    createdAt,
  })
}

/** One piece of `delivery` sold at `at` (the lot's stock goes down with it). */
async function sell(delivery: Delivery, buyerId: number, at: DateTime) {
  const order = await Order.create({
    buyerId,
    deliveryId: delivery.id,
    channel: 'web',
    unitPrice: delivery.price,
    createdAt: at,
  })
  await Delivery.query().where('id', delivery.id).decrement('amountLeft', 1)
  return order
}

async function state(id: number) {
  const d = await Delivery.findOrFail(id)
  return { supplied: d.amountSupplied, left: d.amountLeft, lost: d.amountLost }
}

async function errorOf(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    () => null,
    (e: Error) => e.message
  )
}

const ago = (minutes: number) => DateTime.now().minus({ minutes })

test.group('Inventory — limits of a count (U-I2, U-I3)', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a count expecting more than the stock writes off only what exists', async ({ assert }) => {
    // The sheet says 10, the system has 3, nothing is on the shelf. FIFO can take 3, not 10.
    // Catches: a takeLoss that goes negative or records the unclamped difference.
    const supplier = await UserFactory.apply('supplier').create()
    const p = await product()
    const only = await lot(supplier.id, p.id, ago(600), 3, { price: 20, purchasePrice: 12 })

    const count = await inventory.commitCount(supplier, {
      scope: 'all',
      items: [{ productId: p.id, expected: 10, counted: 0 }],
    })

    assert.deepEqual(await state(only.id), { supplied: 3, left: 0, lost: 3 })
    const [item] = await InventoryCountItem.query().where('inventoryCountId', count.id)
    assert.deepEqual([item.expectedQty, item.countedQty, item.appliedQty], [10, 0, -3])
    const rows = await StockAdjustment.query().where('inventoryCountId', count.id)
    assert.deepEqual(
      rows.map((r) => [r.kind, r.quantity]),
      [['loss', 3]]
    )
    const audit = await db.from('audit_logs').where('action', 'inventory.committed').firstOrFail()
    // 3 × 20 at selling price, 3 × 12 at purchase price.
    assert.include(audit.metadata, { lossQuantity: 3, lossValue: 60, lossCost: 36 })
    await assertStockInvariants(assert)
  })

  test('a surplus never lands on a voided lot', async ({ assert }) => {
    // My newest lot is voided, my older one is live and untouched. With no touched lot of mine
    // the rule falls back to my newest lot — which must be the live one, not the void.
    // +2 → live lot 6 → 8 left, lost −2. Catches lockLots without whereNull('voidedAt') (QA-06).
    const me = await UserFactory.apply('supplier').create()
    const p = await product()
    const live = await lot(me.id, p.id, ago(3000), 6)
    const duplicate = await lot(me.id, p.id, ago(60), 6)
    await deliveries.voidDelivery(me, duplicate.id, 'double entry')

    await inventory.commitCount(me, {
      scope: 'mine',
      items: [{ productId: p.id, expected: 6, counted: 8 }],
    })

    assert.deepEqual(await state(live.id), { supplied: 6, left: 8, lost: -2 })
    assert.deepEqual(await state(duplicate.id), { supplied: 0, left: 0, lost: 0 })
    await assertStockInvariants(assert)
  })

  test('a surplus with no live lot at all changes nothing and records nothing', async ({
    assert,
  }) => {
    // Only a voided lot exists — there is no lot to put the pieces on.
    const me = await UserFactory.apply('supplier').create()
    const p = await product()
    const voided = await lot(me.id, p.id, ago(60), 2)
    await deliveries.voidDelivery(me, voided.id, 'typo')

    const count = await inventory.commitCount(me, {
      scope: 'all',
      items: [{ productId: p.id, expected: 0, counted: 2 }],
    })

    const [item] = await InventoryCountItem.query().where('inventoryCountId', count.id)
    assert.equal(item.appliedQty, 0)
    assert.lengthOf(await StockAdjustment.all(), 0)
    assert.deepEqual(await state(voided.id), { supplied: 0, left: 0, lost: 0 })
    await assertStockInvariants(assert)
  })
})

test.group('Inventory — the sheet, sales and corrections while counting (asOf)', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a delivery and a write-off after the product was counted do not move the count', async ({
    assert,
  }) => {
    // Sheet at −30 min shows 5. Counted at −20 min: 4 on the shelf → one missing.
    // At −10 min a colleague stocks 6 and writes 1 off. They happened AFTER counting, so the
    // expected stock at counting stays 5 and exactly one piece is written off.
    // Catches: `<= countedAt` dropped for deliveries/manual adjustments (would expect 10).
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const p = await product()
    const mine = await lot(me.id, p.id, ago(600), 5)
    await lot(colleague.id, p.id, ago(10), 6)
    await inventory.writeOff(colleague, { productId: p.id, quantity: 1, reason: 'damaged' })
    await db.from('stock_adjustments').update({ created_at: ago(9).toJSDate() })

    await inventory.commitCount(me, {
      scope: 'all',
      items: [
        {
          productId: p.id,
          expected: 5,
          counted: 4,
          asOf: ago(30).toJSDate(),
          countedAt: ago(20).toJSDate(),
        },
      ],
    })

    const [item] = await InventoryCountItem.all()
    assert.deepEqual([item.expectedQty, item.appliedQty, item.sheetQty], [5, -1, null])
    // The colleague's write-off came off my older lot (FIFO), then my count took one more.
    assert.deepEqual(await state(mine.id), { supplied: 5, left: 3, lost: 2 })
    await assertStockInvariants(assert)
  })

  test('without a counting time everything up to now happened before the count', async ({
    assert,
  }) => {
    // Sheet at −10 min shows 5, a sale at −5 min, then 4 counted with no countedAt (a count
    // dictated just now). Expected at counting = 5 − 1 = 4 → nothing is missing.
    // Catches: countedAt defaulting to asOf (the sale would become a false shortfall).
    const me = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const p = await product()
    const only = await lot(me.id, p.id, ago(600), 5)
    await sell(only, buyer.id, ago(5))

    await inventory.commitCount(me, {
      scope: 'all',
      items: [{ productId: p.id, expected: 5, counted: 4, asOf: ago(10).toJSDate() }],
    })

    const [item] = await InventoryCountItem.all()
    assert.deepEqual([item.expectedQty, item.appliedQty, item.sheetQty], [4, 0, 5])
    assert.deepEqual(await state(only.id), { supplied: 5, left: 4, lost: 0 })
    await assertStockInvariants(assert)
  })

  test('two counts of one product committed at the same time write the shortfall off once', async ({
    assert,
  }) => {
    // PRO-05 in real parallel: both sheets show 6, both count 5. The second transaction waits
    // for the lot lock, then sees the first one's correction since asOf → expected 5 → 0.
    // Catches: reading the corrections before the lots are locked, or forUpdate dropped.
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const p = await product()
    const only = await lot(me.id, p.id, ago(600), 6)
    const item = {
      productId: p.id,
      expected: 6,
      counted: 5,
      asOf: ago(10).toJSDate(),
      countedAt: ago(5).toJSDate(),
    }

    for (let round = 0; round < 5; round++) {
      await Delivery.query().where('id', only.id).update({ amountLeft: 6, amountLost: 0 })
      await db.from('stock_adjustments').delete()
      const results = await Promise.allSettled([
        inventory.commitCount(me, { scope: 'all', items: [item] }),
        inventory.commitCount(colleague, { scope: 'all', items: [item] }),
      ])
      assert.deepEqual(
        results.map((r) => r.status),
        ['fulfilled', 'fulfilled']
      )
      assert.deepEqual(await state(only.id), { supplied: 6, left: 5, lost: 1 }, `round ${round}`)
    }
    await assertStockInvariants(assert)
  })

  test('a purchase cancelled while counting is not found again as a surplus', async ({
    assert,
  }) => {
    // A mistaken purchase at −20 min (the piece never left the shelf): system 5, shelf 6.
    // Sheet loaded at −10 min shows 5, counted at −2 min: 6. Before the count is saved, an
    // admin cancels the purchase — that already puts the piece back (system 6 = shelf 6).
    // The count must not add it a second time; like another inventory committed since the
    // sheet was loaded, the storno fixed this very difference. Expected: nothing applied.
    const me = await UserFactory.apply('supplier').create()
    const boss = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const p = await product()
    const only = await lot(me.id, p.id, ago(600), 6)
    const mistake = await sell(only, buyer.id, ago(20))
    mail.fake()
    await new AdminService().stornoOrder(mistake.id, boss.id)
    mail.restore()

    await inventory.commitCount(me, {
      scope: 'all',
      items: [
        {
          productId: p.id,
          expected: 5,
          counted: 6,
          asOf: ago(10).toJSDate(),
          countedAt: ago(2).toJSDate(),
        },
      ],
    })

    assert.deepEqual(await state(only.id), { supplied: 6, left: 6, lost: 0 })
    await assertStockInvariants(assert)
  })

  test('a write-off reverted while counting is not found again as a surplus', async ({
    assert,
  }) => {
    // A write-off at −60 min by mistake (pieces still on the shelf): system 4, shelf 6.
    // Sheet at −10 min shows 4, counted at −2 min: 6. Before the count is saved the write-off
    // is reverted: system 6 = shelf 6. Like a colleague's inventory since asOf, the revert
    // fixed this very difference — the count must not add the 2 pieces again.
    const me = await UserFactory.apply('supplier').create()
    const p = await product()
    const only = await lot(me.id, p.id, ago(600), 6)
    const [row] = await inventory.writeOff(me, { productId: p.id, quantity: 2, reason: 'expired' })
    await db
      .from('stock_adjustments')
      .where('id', row.id)
      .update({ created_at: ago(60).toJSDate() })
    await inventory.revertWriteOff(me, row.id)

    await inventory.commitCount(me, {
      scope: 'all',
      items: [
        {
          productId: p.id,
          expected: 4,
          counted: 6,
          asOf: ago(10).toJSDate(),
          countedAt: ago(2).toJSDate(),
        },
      ],
    })

    assert.deepEqual(await state(only.id), { supplied: 6, left: 6, lost: 0 })
    await assertStockInvariants(assert)
  })

  test('a purchase made and cancelled while counting cancels out', async ({ assert }) => {
    // Sheet at −10 min: 6. A mistaken purchase at −5 min (piece stays on the shelf), cancelled
    // before the count is saved. The sale and its storno both happened after the sheet, so
    // neither moves the expected stock: 6 expected, 6 counted → nothing applied.
    // Catches: a storno replayed although its purchase was not on the sheet (+1 → false loss).
    const me = await UserFactory.apply('supplier').create()
    const boss = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const p = await product()
    const only = await lot(me.id, p.id, ago(600), 6)
    const mistake = await orders.purchase(buyer.id, only.id, 'web')
    await Order.query()
      .where('id', mistake.id)
      .update({ createdAt: ago(5).toJSDate() })
    mail.fake()
    await new AdminService().stornoOrder(mistake.id, boss.id)
    mail.restore()

    await inventory.commitCount(me, {
      scope: 'all',
      items: [
        {
          productId: p.id,
          expected: 6,
          counted: 6,
          asOf: ago(10).toJSDate(),
          countedAt: ago(2).toJSDate(),
        },
      ],
    })

    const [item] = await InventoryCountItem.all()
    assert.deepEqual([item.expectedQty, item.appliedQty], [6, 0])
    assert.deepEqual(await state(only.id), { supplied: 6, left: 6, lost: 0 })
    await assertStockInvariants(assert)
  })

  test('a write-off made and reverted while counting cancels out', async ({ assert }) => {
    // Sheet at −10 min: 6. A write-off of 2 at −5 min by mistake, reverted before the count is
    // saved. Both after the sheet → no movement: 6 expected, 6 counted → nothing applied.
    // Catches: the revert replayed for a write-off the sheet never showed (+2 → false loss).
    const me = await UserFactory.apply('supplier').create()
    const p = await product()
    const only = await lot(me.id, p.id, ago(600), 6)
    const [row] = await inventory.writeOff(me, { productId: p.id, quantity: 2, reason: 'other' })
    await db
      .from('stock_adjustments')
      .where('id', row.id)
      .update({ created_at: ago(5).toJSDate() })
    await inventory.revertWriteOff(me, row.id)

    await inventory.commitCount(me, {
      scope: 'all',
      items: [
        {
          productId: p.id,
          expected: 6,
          counted: 6,
          asOf: ago(10).toJSDate(),
          countedAt: ago(2).toJSDate(),
        },
      ],
    })

    const [item] = await InventoryCountItem.all()
    assert.deepEqual([item.expectedQty, item.appliedQty], [6, 0])
    assert.deepEqual(await state(only.id), { supplied: 6, left: 6, lost: 0 })
    await assertStockInvariants(assert)
  })
})

test.group('Inventory — whose products are "mine" (U-I5)', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('my sold-out old lots and my voided lots do not put a colleague’s product on my sheet', async ({
    assert,
  }) => {
    // Q: my lot empty and 100 days old + colleague 5 → not mine.
    // R: my voided lot (recent) + colleague 5 → not mine.
    // S: my lot empty but 10 days old + colleague 5 → mine (recently delivered, may be on shelf).
    // T: my lot 89 days old, empty → mine; U: 91 days old, empty → not (90-day window).
    // Catches QA-14: dropping amount_left > 0 / whereNull(voided_at) / the 90-day window.
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const [q, r, s, t, u] = await Promise.all(['Q', 'R', 'S', 'T', 'U'].map((n) => product(n)))
    await lot(me.id, q.id, DateTime.now().minus({ days: 100 }), 3, { left: 0 })
    const rVoid = await lot(me.id, r.id, ago(60), 3)
    await deliveries.voidDelivery(me, rVoid.id, 'typo')
    await lot(me.id, s.id, DateTime.now().minus({ days: 10 }), 3, { left: 0 })
    await lot(me.id, t.id, DateTime.now().minus({ days: 89 }), 3, { left: 0 })
    await lot(me.id, u.id, DateTime.now().minus({ days: 91 }), 3, { left: 0 })
    for (const other of [q, r, s, t, u]) {
      await lot(colleague.id, other.id, DateTime.now().minus({ days: 200 }), 5)
    }

    const mine = await inventory.getCountableProducts(me, 'mine')
    assert.sameMembers(
      mine.map((row) => row.productId),
      [s.id, t.id]
    )
    // The stock on the sheet is the whole fridge's — the shelf is shared.
    assert.deepEqual(
      mine.map((row) => row.stock),
      [5, 5]
    )
    const all = await inventory.getCountableProducts(me, 'all')
    assert.lengthOf(all, 5)
  })
})

test.group('Inventory — what the history says (U-I6, U-I7)', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a past count is valued at selling and at purchase price, a surplus apart', async ({
    assert,
  }) => {
    // Loss: 2 pcs of a lot sold at 15, bought at 12.5 → value 30, cost 25.
    // Loss: 1 pc of a lot without a purchase price, sold at 20 → value 20, cost falls back to 20.
    // Surplus: 1 pc of a third product — never part of the loss value.
    // Totals: lossValue 50, lossCost 45, lossQuantity 3, surplusQuantity 1.
    const me = await UserFactory.apply('supplier').create()
    const [a, b, c] = [await product(), await product(), await product()]
    await lot(me.id, a.id, ago(600), 5, { price: 15, purchasePrice: 12.5 })
    await lot(me.id, b.id, ago(600), 5, { price: 20 })
    const cLot = await lot(me.id, c.id, ago(600), 5, { price: 99, purchasePrice: 90 })
    await sell(cLot, me.id, ago(100))
    await sell(cLot, me.id, ago(100))

    await inventory.commitCount(me, {
      scope: 'mine',
      items: [
        { productId: a.id, expected: 5, counted: 3 },
        { productId: b.id, expected: 5, counted: 4 },
        { productId: c.id, expected: 3, counted: 4 },
      ],
    })

    const { data } = await inventory.listCounts(1, 10)
    assert.lengthOf(data, 1)
    assert.include(data[0], {
      products: 3,
      lossQuantity: 3,
      surplusQuantity: 1,
      lossValue: 50,
      lossCost: 45,
    })
    await assertStockInvariants(assert)
  })

  test('a count over several suppliers audits each owner once with their own numbers', async ({
    assert,
  }) => {
    // Ann loses 2 (cola) + 1 (chips) = 3; Bob gets a surplus of 1 (water); my own lot loses 1.
    // stock.adjusted: exactly one for Ann {loss 3, surplus 0} and one for Bob {0, 1}; none for me.
    const me = await UserFactory.apply('supplier').create()
    const ann = await UserFactory.apply('supplier').create()
    const bob = await UserFactory.apply('supplier').create()
    const [cola, chips, water, juice] = [
      await product(),
      await product(),
      await product(),
      await product(),
    ]
    await lot(ann.id, cola.id, ago(600), 5)
    await lot(ann.id, chips.id, ago(600), 5)
    const waterLot = await lot(bob.id, water.id, ago(600), 5)
    await sell(waterLot, me.id, ago(100))
    await lot(me.id, juice.id, ago(600), 5)

    const count = await inventory.commitCount(me, {
      scope: 'all',
      items: [
        { productId: cola.id, expected: 5, counted: 3 },
        { productId: chips.id, expected: 5, counted: 4 },
        { productId: water.id, expected: 4, counted: 5 },
        { productId: juice.id, expected: 5, counted: 4 },
      ],
    })

    const audit = await db
      .from('audit_logs')
      .where('action', 'stock.adjusted')
      .where('entity_id', count.id)
    const byTarget = new Map(audit.map((row) => [row.target_user_id, row.metadata]))
    assert.lengthOf(audit, 2)
    assert.include(byTarget.get(ann.id), { lossQuantity: 3, surplusQuantity: 0 })
    assert.include(byTarget.get(bob.id), { lossQuantity: 0, surplusQuantity: 1 })
    await assertStockInvariants(assert)
  })
})

test.group('Write-off revert — boundaries', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('the 7-day window holds to the minute', ({ assert }) => {
    // Pure rule: ≤ 7 × 24 h old is revertible, a minute later it is not.
    const now = new Date('2026-10-04T12:00:00Z')
    const actor = { id: 1, role: 'supplier' as const }
    const writeOff = (createdAt: Date) => ({
      kind: 'loss',
      inventoryCountId: null,
      revertedAt: null,
      actorId: 1,
      createdAt,
    })
    const week = 7 * 86_400_000
    assert.isTrue(canRevertWriteOff(writeOff(new Date(now.getTime() - week)), actor, now))
    assert.isFalse(canRevertWriteOff(writeOff(new Date(now.getTime() - week - 60_000)), actor, now))
    assert.isTrue(canRevertWriteOff(writeOff(new Date(now.getTime() - week + 60_000)), actor, now))
    // Not mine, not a loss, part of an inventory, or reverted already → never.
    assert.isFalse(canRevertWriteOff({ ...writeOff(now), actorId: 2 }, actor, now))
    assert.isTrue(
      canRevertWriteOff({ ...writeOff(now), actorId: 2 }, { id: 9, role: 'admin' }, now)
    )
    assert.isFalse(canRevertWriteOff({ ...writeOff(now), kind: 'surplus' }, actor, now))
    assert.isFalse(canRevertWriteOff({ ...writeOff(now), inventoryCountId: 3 }, actor, now))
    assert.isFalse(canRevertWriteOff({ ...writeOff(now), revertedAt: now }, actor, now))
  })

  test('the service refuses a write-off older than 7 days and allows one just inside', async ({
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const p = await product()
    await lot(me.id, p.id, ago(60 * 24 * 30), 10)
    const [inside] = await inventory.writeOff(me, {
      productId: p.id,
      quantity: 1,
      reason: 'expired',
    })
    const [outside] = await inventory.writeOff(me, {
      productId: p.id,
      quantity: 2,
      reason: 'expired',
    })
    const week = 7 * 24 * 60
    await db
      .from('stock_adjustments')
      .where('id', inside.id)
      .update({ created_at: ago(week - 1).toJSDate() })
    await db
      .from('stock_adjustments')
      .where('id', outside.id)
      .update({ created_at: ago(week + 1).toJSDate() })

    assert.equal(await errorOf(inventory.revertWriteOff(me, outside.id)), 'REVERT_TOO_LATE')
    await inventory.revertWriteOff(me, inside.id)
    // 10 − 1 − 2 + 1 = 8 left, 2 still lost.
    const [only] = await Delivery.all()
    assert.deepEqual(await state(only.id), { supplied: 10, left: 8, lost: 2 })
    await assertStockInvariants(assert)
  })

  test('the same write-off reverted twice at once comes back once', async ({ assert }) => {
    // Catches: the adjustment read without FOR UPDATE — both would add the pieces back.
    const me = await UserFactory.apply('supplier').create()
    const p = await product()
    const only = await lot(me.id, p.id, ago(600), 10)
    for (let round = 0; round < 5; round++) {
      const [row] = await inventory.writeOff(me, { productId: p.id, quantity: 3, reason: 'stolen' })
      const results = await Promise.allSettled([
        inventory.revertWriteOff(me, row.id),
        inventory.revertWriteOff(me, row.id),
      ])
      const failures = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => r.reason.message)
      assert.deepEqual(failures, ['ALREADY_REVERTED'], `round ${round}`)
      assert.deepEqual(await state(only.id), { supplied: 10, left: 10, lost: 0 })
    }
    await assertStockInvariants(assert)
  })

  test('after a revert the lot is sold first again and a later count sees the pieces', async ({
    assert,
  }) => {
    // Old lot (2 pcs) written off entirely, newer lot 3 pcs. Revert → old lot 2 again and FIFO
    // sells it before the newer one. A count of 5 then finds nothing missing.
    const me = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const p = await product()
    const old = await lot(me.id, p.id, ago(600), 2, { price: 10 })
    const newer = await lot(me.id, p.id, ago(300), 3, { price: 12 })
    const [row] = await inventory.writeOff(me, { productId: p.id, quantity: 2, reason: 'damaged' })
    await inventory.revertWriteOff(me, row.id)

    const order = await orders.purchase(buyer.id, newer.id, 'web', 10)
    assert.equal(order.deliveryId, old.id)
    await inventory.commitCount(me, {
      scope: 'all',
      items: [{ productId: p.id, counted: 4 }],
    })
    assert.lengthOf(await StockAdjustment.query().whereNotNull('inventoryCountId'), 0)
    await assertStockInvariants(assert)
  })
})

test.group('Handover of stock — edges', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a write-off reverted after the handover goes to the heir and balances', async ({
    assert,
  }) => {
    // Lot 10 of the leaver: 2 written off by mistake, 3 sold → 5 left, handed to the heir.
    // Original: supplied 3 + 2 = 5, left 0. The leaver no longer sells anything, so the
    // reverted pieces follow the stock to the heir's lot: the original gives them up
    // (supplied 3 = sold), the heir's lot grows by 2 and sells them.
    const leaver = await UserFactory.apply('supplier').create()
    const heir = await UserFactory.apply('supplier').create()
    const boss = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const p = await product()
    const original = await lot(leaver.id, p.id, ago(600), 10)
    const [row] = await inventory.writeOff(leaver, {
      productId: p.id,
      quantity: 2,
      reason: 'damaged',
    })
    for (let i = 0; i < 3; i++) await orders.purchase(buyer.id, original.id, 'web')

    const result = await deliveries.transferStock(leaver.id, heir.id, boss)
    const heirLot = result.lots[0].toDeliveryId
    assert.deepEqual(await state(original.id), { supplied: 5, left: 0, lost: 2 })
    assert.deepEqual(await state(heirLot), { supplied: 5, left: 5, lost: 0 })

    await inventory.revertWriteOff(leaver, row.id)
    assert.deepEqual(await state(original.id), { supplied: 3, left: 0, lost: 0 })
    assert.deepEqual(await state(heirLot), { supplied: 7, left: 7, lost: 0 })
    const next = await orders.purchase(buyer.id, heirLot, 'web')
    assert.equal(next.deliveryId, heirLot)
    await assertStockInvariants(assert)
  })

  test('the heir’s inventory surplus goes onto the handed-over lot, not the leaver’s', async ({
    assert,
  }) => {
    // After the handover the leaver's lot is empty and the heir holds the only live pieces.
    // A surplus counted by the heir goes onto the heir's lot (theirs, though untouched).
    const leaver = await UserFactory.apply('supplier').create()
    const heir = await UserFactory.apply('supplier').create()
    const boss = await UserFactory.apply('admin').create()
    const p = await product()
    const original = await lot(leaver.id, p.id, ago(600), 4)
    const { lots } = await deliveries.transferStock(leaver.id, heir.id, boss)

    await inventory.commitCount(heir, {
      scope: 'mine',
      items: [{ productId: p.id, expected: 4, counted: 5 }],
    })
    assert.deepEqual(await state(lots[0].toDeliveryId), { supplied: 4, left: 5, lost: -1 })
    assert.deepEqual(await state(original.id), { supplied: 0, left: 0, lost: 0 })
    await assertStockInvariants(assert)
  })

  test('a handed-over lot cannot be voided — its pieces would vanish without a trace', async ({
    assert,
  }) => {
    // Void is for a duplicate entry. The heir's lot is real stock the leaver paid for; voiding
    // it drops 5 pieces from the system with no write-off and no shrinkage for anyone.
    const leaver = await UserFactory.apply('supplier').create()
    const heir = await UserFactory.apply('supplier').create()
    const boss = await UserFactory.apply('admin').create()
    const p = await product()
    await lot(leaver.id, p.id, ago(600), 5)
    const { lots } = await deliveries.transferStock(leaver.id, heir.id, boss)

    assert.equal(
      await errorOf(deliveries.voidDelivery(heir, lots[0].toDeliveryId, 'oops')),
      'DELIVERY_TRANSFERRED'
    )
    // The emptied original (0/0/0, nothing sold) looks voidable too — it is not.
    assert.equal(
      await errorOf(deliveries.voidDelivery(boss, lots[0].fromDeliveryId, 'oops')),
      'DELIVERY_TRANSFERRED'
    )
    assert.deepEqual(await state(lots[0].toDeliveryId), { supplied: 5, left: 5, lost: 0 })
    await assertStockInvariants(assert)
  })

  test('a storno after the handover returns the piece to the heir who holds the stock', async ({
    assert,
  }) => {
    const leaver = await UserFactory.apply('supplier').create()
    const heir = await UserFactory.apply('supplier').create()
    const boss = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const p = await product()
    const original = await lot(leaver.id, p.id, ago(600), 4)
    const order = await orders.purchase(buyer.id, original.id, 'web')
    const { lots } = await deliveries.transferStock(leaver.id, heir.id, boss)

    await new AdminService().stornoOrder(order.id, boss.id)
    // Original: supplied 1 (the sale). The sale is gone, and the leaver no longer sells — the
    // piece goes on to the heir's lot, so the original ends up empty.
    assert.deepEqual(await state(original.id), { supplied: 0, left: 0, lost: 0 })
    assert.deepEqual(await state(lots[0].toDeliveryId), { supplied: 4, left: 4, lost: 0 })
    await assertStockInvariants(assert)
  })
})

test.group('Delivery corrections — exact boundaries (U-D1, U-D2)', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('the amount can go down exactly to what is gone, not one piece lower', async ({
    assert,
  }) => {
    // 10 supplied, 2 sold, 1 written off → 3 gone. amount 3 OK (left 0); amount 2 refused.
    // Catches `<` → `<=` (QA-10) and sold computed without the loss.
    const me = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const p = await product()
    const only = await lot(me.id, p.id, ago(600), 10, { price: 10 })
    await orders.purchase(buyer.id, only.id, 'web')
    await orders.purchase(buyer.id, only.id, 'web')
    await inventory.writeOff(me, { productId: p.id, quantity: 1, reason: 'damaged' })

    assert.equal(
      await errorOf(deliveries.correctDelivery(me, only.id, { amount: 2, price: 10, reason: 'x' })),
      'AMOUNT_BELOW_SOLD'
    )
    await deliveries.correctDelivery(me, only.id, { amount: 3, price: 10, reason: 'typo' })
    assert.deepEqual(await state(only.id), { supplied: 3, left: 0, lost: 1 })
    await assertStockInvariants(assert)
  })

  test('a correction reprices only the purchases of its own lot', async ({ assert }) => {
    // Lot X (mine) and lot Y (colleague's, another product), 2 uninvoiced purchases each.
    // Correcting X's price must leave Y's orders untouched. Catches QA-02.
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const [px, py] = [await product(), await product()]
    const x = await lot(me.id, px.id, ago(600), 5, { price: 10 })
    const y = await lot(colleague.id, py.id, ago(600), 5, { price: 10 })
    for (const target of [x, x, y, y]) await orders.purchase(buyer.id, target.id, 'web')

    const { correction } = await deliveries.correctDelivery(me, x.id, {
      amount: 5,
      price: 12,
      reason: 'typo',
    })

    assert.equal(correction.repricedOrderCount, 2)
    const ofY = await Order.query().where('deliveryId', y.id)
    assert.deepEqual(
      ofY.map((o) => [o.unitPrice, o.originalUnitPrice, o.priceCorrectionId]),
      [
        [10, null, null],
        [10, null, null],
      ]
    )
    const ofX = await Order.query().where('deliveryId', x.id)
    assert.deepEqual(
      ofX.map((o) => [o.unitPrice, o.originalUnitPrice]),
      [
        [12, 10],
        [12, 10],
      ]
    )
    await assertStockInvariants(assert)
  })

  test('storno of an invoiced purchase is refused and the stock stays', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const boss = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const p = await product()
    const only = await lot(me.id, p.id, ago(600), 3, { price: 10 })
    const order = await orders.purchase(buyer.id, only.id, 'web')
    await new InvoiceService().generateInvoiceForBuyer(me.id, buyer.id)

    assert.equal(
      await errorOf(new AdminService().stornoOrder(order.id, boss.id)),
      'ORDER_ALREADY_INVOICED'
    )
    assert.deepEqual(await state(only.id), { supplied: 3, left: 2, lost: 0 })
    assert.lengthOf(await Order.all(), 1)
    await assertStockInvariants(assert)
  })
})

test.group('Stocking warnings — exact boundaries (U-D4, U-D5)', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('an unusual price is flagged from exactly 1.5× in both directions', async ({ assert }) => {
    // isUnusual = |Δ| > 5 AND (new ≥ 1.5·last OR 1.5·new ≤ last).
    // 20 → 30: Δ 10, 30 ≥ 30 → flag. 20 → 29: 29 < 30 → none. 30 → 20: 30 ≤ 30 → flag.
    // 30 → 21: 31.5 > 30 → none. Catches `>=` → `>` and `<=` → `<`.
    const me = await UserFactory.apply('supplier').create()
    const other = await UserFactory.apply('supplier').create()
    const [p20, p30] = [await product(), await product()]
    await lot(me.id, p20.id, ago(600), 5, { price: 20 })
    await lot(me.id, p30.id, ago(600), 5, { price: 30 })

    const flag = async (productId: number, price: number) => {
      const warnings = await deliveries.getStockWarnings(other.id, productId, price)
      return warnings?.unusualPrice?.lastPrice ?? null
    }
    assert.equal(await flag(p20.id, 30), 20)
    assert.isNull(await flag(p20.id, 29))
    assert.equal(await flag(p30.id, 20), 30)
    assert.isNull(await flag(p30.id, 21))
  })

  test('a duplicate is my own live lot of the product from the last 30 minutes', async ({
    assert,
  }) => {
    // 29 min → duplicate; 31 min → none; a colleague's lot 5 min ago → none; my voided lot
    // 5 min ago → none. Catches the window, the supplier filter and the voided filter.
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const [inWindow, outside, theirs, voided] = [
      await product(),
      await product(),
      await product(),
      await product(),
    ]
    await lot(me.id, inWindow.id, ago(29), 4, { price: 15 })
    await lot(me.id, outside.id, ago(31), 4, { price: 15 })
    await lot(colleague.id, theirs.id, ago(5), 4, { price: 15 })
    const v = await lot(me.id, voided.id, ago(5), 4, { price: 15 })
    await deliveries.voidDelivery(me, v.id, 'typo')

    const duplicate = async (productId: number) => {
      const warnings = await deliveries.getStockWarnings(me.id, productId, 15)
      return warnings?.duplicate ?? null
    }
    assert.deepEqual(await duplicate(inWindow.id), { amount: 4, price: 15, minutesAgo: 29 })
    assert.isNull(await duplicate(outside.id))
    assert.isNull(await duplicate(theirs.id))
    assert.isNull(await duplicate(voided.id))
  })
})

test.group('Stock overview — sales and write-offs per scope (U-D3)', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('sold, sold in 30 days, remaining and value count only the scope', async ({ assert }) => {
    // Product "Alfa": my lot 10 @10 Kč (50 d old): 3 sold 10 d ago, 1 sold 40 d ago, 1 written
    // off → left 5. Colleague's lot 10 @20 Kč (20 d old): 5 sold 5 d ago → left 5.
    // Product "Beta": my lot 30 @1 Kč (60 d old), untouched.
    // all:  Alfa supplied 20, left 10, sold 9, sold30 8, delivered30 1, value 5·10+5·20 = 150
    // mine: Alfa supplied 10, left 5,  sold 4, sold30 3, delivered30 0, value 50
    // Catches QA-07: ownOnly dropped in `sold`, the period comparison flipped, `- amount_lost`
    // dropped from total_sold (the write-off would count as a sale).
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const alfa = await product('Alfa')
    const beta = await product('Beta')
    const days = (n: number) => DateTime.now().minus({ days: n })
    const mine = await lot(me.id, alfa.id, days(50), 10, { price: 10 })
    const theirs = await lot(colleague.id, alfa.id, days(20), 10, { price: 20 })
    await lot(me.id, beta.id, days(60), 30, { price: 1 })
    for (let i = 0; i < 3; i++) await sell(mine, buyer.id, days(10))
    await sell(mine, buyer.id, days(40))
    for (let i = 0; i < 5; i++) await sell(theirs, buyer.id, days(5))
    await inventory.writeOff(me, { productId: alfa.id, quantity: 1, reason: 'damaged' })

    const pick = (row: Record<string, unknown>) => ({
      totalSupplied: row.totalSupplied,
      totalRemaining: row.totalRemaining,
      totalSold: row.totalSold,
      soldInPeriod: row.soldInPeriod,
      deliveredInPeriod: row.deliveredInPeriod,
      totalStockValue: row.totalStockValue,
    })
    const all = await deliveries.getStockForSupplier(me.id, 1, 20, { scope: 'all' })
    const alfaAll = all.data.find((r) => r.productId === alfa.id)!
    assert.deepEqual(pick({ ...alfaAll }), {
      totalSupplied: 20,
      totalRemaining: 10,
      totalSold: 9,
      soldInPeriod: 8,
      deliveredInPeriod: 1,
      totalStockValue: 150,
    })
    assert.equal(alfaAll.myRemaining, 5)
    const mineView = await deliveries.getStockForSupplier(me.id, 1, 20, { scope: 'mine' })
    const alfaMine = mineView.data.find((r) => r.productId === alfa.id)!
    assert.deepEqual(pick({ ...alfaMine }), {
      totalSupplied: 10,
      totalRemaining: 5,
      totalSold: 4,
      soldInPeriod: 3,
      deliveredInPeriod: 0,
      totalStockValue: 50,
    })
    // 5 (Alfa) + 30 (Beta) in my scope.
    assert.equal(mineView.totals.totalRemaining, 35)
    await assertStockInvariants(assert)
  })

  test('every activity column sorts both ways in SQL', async ({ assert }) => {
    // Alfa: supplied 20, sold 9, sold30 8, value 11 × 10 = 110. Beta: supplied 30, sold 0, sold30 0,
    // value 30. Name order is [Alfa, Beta], so each sort below must differ from it at least
    // in one direction — otherwise a sort silently ignored would pass.
    const me = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const alfa = await product('Alfa')
    const beta = await product('Beta')
    const a = await lot(me.id, alfa.id, ago(60 * 24 * 20), 20, { price: 10 })
    await lot(me.id, beta.id, ago(60 * 24 * 20), 30, { price: 1 })
    for (let i = 0; i < 8; i++) await sell(a, buyer.id, ago(60 * 24 * 3))
    await sell(a, buyer.id, ago(60 * 24 * 40))

    const order = async (sortBy: string, sortOrder: string) => {
      const overview = await deliveries.getStockForSupplier(me.id, 1, 20, { sortBy, sortOrder })
      return overview.data.map((r) => r.productName)
    }
    assert.deepEqual(await order('soldInPeriod', 'asc'), ['Beta', 'Alfa'])
    assert.deepEqual(await order('soldInPeriod', 'desc'), ['Alfa', 'Beta'])
    assert.deepEqual(await order('totalSold', 'asc'), ['Beta', 'Alfa'])
    assert.deepEqual(await order('totalSupplied', 'desc'), ['Beta', 'Alfa'])
    assert.deepEqual(await order('totalSupplied', 'asc'), ['Alfa', 'Beta'])
    assert.deepEqual(await order('totalStockValue', 'asc'), ['Beta', 'Alfa'])
    assert.deepEqual(await order('totalStockValue', 'desc'), ['Alfa', 'Beta'])
  })
})
