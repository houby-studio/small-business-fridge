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
import type User from '#models/user'
import InventoryService from '#services/inventory_service'
import DeliveryService from '#services/delivery_service'
import OrderService from '#services/order_service'
import AdminService from '#services/admin_service'
import { assertStockInvariants } from '#tests/helpers/stock_invariants'

/**
 * Real parallel transactions on one product (Promise.allSettled — every service call opens its
 * own transaction on its own pool connection). A race is not deterministic, so each scenario
 * runs several rounds on a fresh product and asserts what must hold for EVERY interleaving:
 * nothing is sold or written off twice, refusals carry the right code, nothing deadlocks, and
 * the invariants I1–I7 hold at the end.
 */

const ROUNDS = 8
const inventory = new InventoryService()
const deliveries = new DeliveryService()
const orders = new OrderService()

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

async function freshLot(supplier: User, amount: number, price = 10) {
  const category = await CategoryFactory.create()
  const product = await ProductFactory.merge({ categoryId: category.id }).create()
  const delivery = await Delivery.create({
    supplierId: supplier.id,
    productId: product.id,
    amountSupplied: amount,
    amountLeft: amount,
    amountLost: 0,
    price,
    purchasePrice: null,
    createdAt: DateTime.now().minus({ days: 1 }),
  })
  return { product, delivery }
}

function outcome(results: PromiseSettledResult<unknown>[]) {
  return results.map((r) => (r.status === 'fulfilled' ? 'ok' : (r.reason as Error).message))
}

async function lotState(id: number) {
  const d = await Delivery.findOrFail(id)
  const sold = await Order.query().where('deliveryId', id).count('* as n').firstOrFail()
  return { left: d.amountLeft, lost: d.amountLost, sold: Number(sold.$extras.n) }
}

test.group('Stock under concurrency', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a write-off racing two purchases never takes a piece twice (U-I4)', async ({ assert }) => {
    // 3 pieces; write-off of 2 + two single purchases ask for 4 → at least one is refused.
    // Whatever wins: left = 3 − 2·[write-off ok] − [purchases ok], never below zero.
    // Catches: lockLots without FOR UPDATE (QA-06) — the write-off would overwrite the
    // purchase's amount_left (a lost update) and I1 would break.
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    for (let round = 0; round < ROUNDS; round++) {
      const { product, delivery } = await freshLot(supplier, 3)
      const results = await Promise.allSettled([
        inventory.writeOff(supplier, { productId: product.id, quantity: 2, reason: 'damaged' }),
        orders.purchase(buyer.id, delivery.id, 'web'),
        orders.purchase(buyer.id, delivery.id, 'web'),
      ])
      const [writeOff, ...purchases] = outcome(results)
      assert.include(['ok', 'NOT_ENOUGH_STOCK'], writeOff, `round ${round}`)
      purchases.forEach((p) => assert.include(['ok', 'OUT_OF_STOCK'], p, `round ${round}`))
      const bought = purchases.filter((p) => p === 'ok').length
      const wroteOff = writeOff === 'ok' ? 2 : 0
      // Whatever order: a write-off that went through leaves exactly one piece for one buyer;
      // a refused write-off means both purchases came first. Nothing is refused with stock left.
      assert.equal(bought, writeOff === 'ok' ? 1 : 2, `round ${round}: ${outcome(results)}`)
      assert.deepEqual(await lotState(delivery.id), {
        left: 3 - wroteOff - bought,
        lost: wroteOff,
        sold: bought,
      })
    }
    await assertStockInvariants(assert)
  })

  test('two write-offs of the last pieces: exactly one goes through', async ({ assert }) => {
    // 3 pieces, two write-offs of 2 each. Only one fits; the other is NOT_ENOUGH_STOCK.
    const a = await UserFactory.apply('supplier').create()
    const b = await UserFactory.apply('supplier').create()
    for (let round = 0; round < ROUNDS; round++) {
      const { product, delivery } = await freshLot(a, 3)
      const results = await Promise.allSettled([
        inventory.writeOff(a, { productId: product.id, quantity: 2, reason: 'expired' }),
        inventory.writeOff(b, { productId: product.id, quantity: 2, reason: 'stolen' }),
      ])
      assert.sameMembers(outcome(results), ['ok', 'NOT_ENOUGH_STOCK'], `round ${round}`)
      assert.deepEqual(await lotState(delivery.id), { left: 1, lost: 2, sold: 0 })
    }
    await assertStockInvariants(assert)
  })

  test('a correction racing purchases never oversells the corrected lot (U-D6)', async ({
    assert,
  }) => {
    // 2 pieces; two purchases and a correction to 1 piece. Every interleaving:
    //  - correction first: 1 piece → one purchase ok, one OUT_OF_STOCK;
    //  - one purchase first: gone 1 → correction to 1 ok (left 0) → other purchase refused;
    //  - both purchases first: gone 2 → AMOUNT_BELOW_SOLD.
    // So: sold ≤ supplied, and the correction succeeds iff exactly one piece was sold.
    // Catches: lockForCorrection without FOR UPDATE (stale `sold`, left would go negative).
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    for (let round = 0; round < ROUNDS; round++) {
      const { delivery } = await freshLot(supplier, 2)
      const results = await Promise.allSettled([
        orders.purchase(buyer.id, delivery.id, 'web'),
        deliveries.correctDelivery(supplier, delivery.id, {
          amount: 1,
          price: 10,
          reason: 'stocked one',
        }),
        orders.purchase(buyer.id, delivery.id, 'web'),
      ])
      const [p1, correction, p2] = outcome(results)
      const bought = [p1, p2].filter((p) => p === 'ok').length
      const after = await Delivery.findOrFail(delivery.id)
      if (correction === 'ok') {
        assert.equal(bought, 1, `round ${round}`)
        assert.deepEqual([after.amountSupplied, after.amountLeft], [1, 0])
      } else {
        assert.equal(correction, 'AMOUNT_BELOW_SOLD', `round ${round}`)
        assert.equal(bought, 2)
        assert.deepEqual([after.amountSupplied, after.amountLeft], [2, 0])
      }
    }
    await assertStockInvariants(assert)
  })

  test('a revert racing a write-off of the same pieces keeps the count exact', async ({
    assert,
  }) => {
    // 5 pieces, 2 written off (left 3). Then at once: revert those 2 and write off 4.
    //  - revert first: 5 left → the write-off of 4 fits → left 1, lost 4;
    //  - write-off first: 3 < 4 → NOT_ENOUGH_STOCK, revert → left 5, lost 0.
    const supplier = await UserFactory.apply('supplier').create()
    for (let round = 0; round < ROUNDS; round++) {
      const { product, delivery } = await freshLot(supplier, 5)
      const [first] = await inventory.writeOff(supplier, {
        productId: product.id,
        quantity: 2,
        reason: 'damaged',
      })
      const results = await Promise.allSettled([
        inventory.revertWriteOff(supplier, first.id),
        inventory.writeOff(supplier, { productId: product.id, quantity: 4, reason: 'expired' }),
      ])
      const [revert, writeOff] = outcome(results)
      assert.equal(revert, 'ok', `round ${round}`)
      const expected =
        writeOff === 'ok' ? { left: 1, lost: 4, sold: 0 } : { left: 5, lost: 0, sold: 0 }
      if (writeOff !== 'ok') assert.equal(writeOff, 'NOT_ENOUGH_STOCK')
      assert.deepEqual(await lotState(delivery.id), expected, `round ${round}`)
    }
    await assertStockInvariants(assert)
  })

  async function handoverRace(round: number) {
    const leaver = await UserFactory.apply('supplier').create()
    const heir = await UserFactory.apply('supplier').create()
    const boss = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const { product, delivery } = await freshLot(leaver, 4)
    const results = await Promise.allSettled([
      orders.purchase(buyer.id, delivery.id, 'web'),
      deliveries.transferStock(leaver.id, heir.id, boss),
      orders.purchase(buyer.id, delivery.id, 'web'),
      orders.purchase(buyer.id, delivery.id, 'kiosk'),
    ])
    const [p1, transfer, p2, p3] = outcome(results)
    const lots = await Delivery.query().where('productId', product.id)
    const sold = await Order.query().whereIn(
      'deliveryId',
      lots.map((l) => l.id)
    )
    const left = lots.reduce((s, l) => s + l.amountLeft, 0)
    return { round, purchases: [p1, p2, p3], transfer, sold: sold.length, left }
  }

  test('a handover racing purchases keeps every piece accounted for', async ({ assert }) => {
    // 4 pieces of the leaver, a handover to the heir and three purchases at once. Pieces are
    // conserved whatever the order: sold + left on both lots = 4, every placed order is one
    // piece less, and a refused purchase is only ever OUT_OF_STOCK.
    for (let round = 0; round < ROUNDS; round++) {
      const race = await handoverRace(round)
      assert.equal(race.transfer, 'ok', `round ${round}`)
      race.purchases.forEach((p) => assert.include(['ok', 'OUT_OF_STOCK'], p))
      assert.equal(race.sold, race.purchases.filter((p) => p === 'ok').length)
      assert.equal(race.sold + race.left, 4, `round ${round}`)
    }
    await assertStockInvariants(assert)
  })

  test('a purchase racing a handover is not refused while the stock is there', async ({
    assert,
  }) => {
    // 4 pieces, 3 purchases: each has a piece whichever lot it sits on. A purchase that waited
    // for the handover's lock must find the heir's new lot, not report sold out.
    for (let round = 0; round < ROUNDS; round++) {
      const race = await handoverRace(round)
      assert.deepEqual(race.purchases, ['ok', 'ok', 'ok'], `round ${round}`)
    }
  })

  test('a reprice racing a purchase never charges a price the buyer did not see', async ({
    assert,
  }) => {
    // The buyer saw 10 Kč; the supplier reprices to 12 at the same time. The purchase either
    // lands before (order at 10) or is refused with PRICE_CHANGED — never an order at 12.
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    for (let round = 0; round < ROUNDS; round++) {
      const { product, delivery } = await freshLot(supplier, 3, 10)
      const results = await Promise.allSettled([
        orders.purchase(buyer.id, delivery.id, 'web', 10),
        deliveries.repriceRemaining(supplier, product.id, 12),
      ])
      const [purchase, reprice] = outcome(results)
      assert.equal(reprice, 'ok', `round ${round}`)
      const placed = await Order.query().where('deliveryId', delivery.id)
      if (purchase === 'ok') {
        assert.deepEqual(
          placed.map((o) => o.unitPrice),
          [10]
        )
      } else {
        assert.equal(purchase, 'PRICE_CHANGED')
        assert.lengthOf(placed, 0)
      }
      const repriced = await Delivery.findOrFail(delivery.id)
      assert.equal(repriced.price, 12)
    }
    await assertStockInvariants(assert)
  })

  test('storno, a price correction and an inventory on one lot at once neither deadlock nor drift', async ({
    assert,
  }) => {
    // 5 pieces, 2 sold. At once: cancel one purchase, correct the price 10 → 11, and count
    // the shelf (no `expected` → the count compares with the stock at its own moment).
    // All three must go through. The other purchase ends at 11 (uninvoiced) and the storno
    // brings one piece back. The count of 3 meets the stock of its own moment: 3 before the
    // storno (nothing missing) or 4 after it (one written off) — its expected_qty says which.
    const supplier = await UserFactory.apply('supplier').create()
    const boss = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const admin = new AdminService()
    for (let round = 0; round < ROUNDS; round++) {
      const { product, delivery } = await freshLot(supplier, 5)
      const cancelled = await orders.purchase(buyer.id, delivery.id, 'web')
      const kept = await orders.purchase(buyer.id, delivery.id, 'web')
      const results = await Promise.allSettled([
        admin.stornoOrder(cancelled.id, boss.id),
        deliveries.correctDelivery(supplier, delivery.id, {
          amount: 5,
          price: 11,
          reason: 'price',
        }),
        inventory.commitCount(supplier, {
          scope: 'all',
          items: [{ productId: product.id, counted: 3 }],
        }),
      ])
      assert.deepEqual(outcome(results), ['ok', 'ok', 'ok'], `round ${round}`)
      await kept.refresh()
      assert.equal(kept.unitPrice, 11)
      // Stock after: 5 − 2 sold + 1 storno = 4, minus what the count found missing.
      const count = results[2] as PromiseFulfilledResult<{ id: number }>
      const item = await db
        .from('inventory_count_items')
        .where('inventory_count_id', count.value.id)
        .firstOrFail()
      const after = await lotState(delivery.id)
      assert.equal(after.sold, 1)
      assert.equal(after.lost, item.expected_qty - 3, `round ${round}`)
      assert.equal(after.left, 4 - after.lost)
    }
    await assertStockInvariants(assert)
  })
})
