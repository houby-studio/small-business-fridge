import '#tests/test_context'
import { test } from '@japa/runner'
import fc from 'fast-check'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Delivery from '#models/delivery'
import type User from '#models/user'
import InventoryService from '#services/inventory_service'
import OrderService from '#services/order_service'
import DeliveryService from '#services/delivery_service'
import AdminService from '#services/admin_service'
import { collectStockViolations } from '#tests/helpers/stock_invariants'

/**
 * U-I1 — model-based test of the whole stock bookkeeping of a product. A sequence of random
 * operations (new lots, some sharing a timestamp; purchases; write-offs; inventories; reverts
 * of write-offs; storno; voids) runs against the real services and against a 30-line
 * reference model written from the rules, not from the code:
 *
 * - FIFO: a purchase and a loss take the oldest lot with pieces left, by created_at, then id.
 * - A loss bigger than the stock is refused as a whole (write-off) — an inventory writes off
 *   what the system thinks is there.
 * - A surplus goes onto a lot of whoever counted that something already left, else their
 *   newest lot, else the newest touched lot of anyone, else the newest lot (PRO-19).
 * - A revert puts the pieces back on the very lot; a storno puts one piece back on the lot.
 * - Only a lot nothing happened to can be voided.
 *
 * After every step each lot must equal the model and the invariants I1–I7 must hold.
 * Catches: a changed FIFO order (DESC, missing id tie-break), off-by-one in take/remaining,
 * a surplus on the wrong lot, a revert on another lot, storno restoring to another lot,
 * voided lots taking part in anything.
 */

interface ModelLot {
  id: number
  supplier: number
  product: number
  at: number
  price: number
  supplied: number
  left: number
  lost: number
  voided: boolean
  /** Took part in a handover (either side) — such a lot is real stock and cannot be voided. */
  handedOver: boolean
}

interface ModelAdjustment {
  id: number
  lot: number
  quantity: number
  author: number
  reverted: boolean
}

type Op =
  | { kind: 'lot'; product: number; supplier: number; slot: number; amount: number; price: number }
  | { kind: 'buy'; product: number }
  | { kind: 'writeOff'; product: number; actor: number; quantity: number }
  | { kind: 'count'; product: number; actor: number; delta: number }
  | { kind: 'revert'; pick: number }
  | { kind: 'storno'; pick: number }
  | { kind: 'void'; pick: number }
  | { kind: 'correct'; pick: number; cut: number; price: number }
  | { kind: 'reprice'; product: number; actor: number; price: number }
  | { kind: 'transfer'; from: number }

const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('lot' as const),
      product: fc.integer({ min: 0, max: 1 }),
      supplier: fc.integer({ min: 0, max: 1 }),
      // Few slots so lots often share a timestamp and only the id decides.
      slot: fc.integer({ min: 0, max: 3 }),
      amount: fc.integer({ min: 1, max: 5 }),
      price: fc.integer({ min: 10, max: 13 }),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('buy' as const),
      product: fc.integer({ min: 0, max: 1 }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('writeOff' as const),
      product: fc.integer({ min: 0, max: 1 }),
      actor: fc.integer({ min: 0, max: 1 }),
      quantity: fc.integer({ min: 1, max: 3 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('count' as const),
      product: fc.integer({ min: 0, max: 1 }),
      actor: fc.integer({ min: 0, max: 1 }),
      delta: fc.integer({ min: -4, max: 3 }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({ kind: fc.constant('revert' as const), pick: fc.nat(20) }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant('storno' as const), pick: fc.nat(20) }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('void' as const), pick: fc.nat(20) }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('correct' as const),
      pick: fc.nat(20),
      cut: fc.nat(3),
      price: fc.integer({ min: 10, max: 13 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('reprice' as const),
      product: fc.integer({ min: 0, max: 1 }),
      actor: fc.integer({ min: 0, max: 1 }),
      price: fc.integer({ min: 10, max: 13 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('transfer' as const),
      from: fc.integer({ min: 0, max: 1 }),
    }),
  }
)

/** How many operations of each kind really ran — a model test that only ever hits refusals proves nothing. */
const executed = new Map<Op['kind'], number>()

const BASE = DateTime.fromISO('2026-09-01T10:00:00Z')

/** Oldest first: created_at, then id. */
const fifo = (lots: ModelLot[], product: number) =>
  lots.filter((l) => l.product === product && !l.voided).sort((a, b) => a.at - b.at || a.id - b.id)

function modelTake(lots: ModelLot[], quantity: number) {
  const taken: Array<{ lot: ModelLot; quantity: number }> = []
  let remaining = quantity
  for (const lot of lots) {
    if (remaining === 0) break
    const take = Math.min(lot.left, remaining)
    if (take === 0) continue
    lot.left -= take
    lot.lost += take
    remaining -= take
    taken.push({ lot, quantity: take })
  }
  return taken
}

function modelSurplusLot(lots: ModelLot[], actor: number): ModelLot | undefined {
  const touched = (l: ModelLot) => l.left < l.supplied
  const last = (pred: (l: ModelLot) => boolean) => lots.filter(pred).at(-1)
  return (
    last((l) => l.supplier === actor && touched(l)) ??
    last((l) => l.supplier === actor) ??
    last(touched) ??
    lots.at(-1)
  )
}

const inventory = new InventoryService()
const orders = new OrderService()
const deliveries = new DeliveryService()
const admin = new AdminService()

async function resetDatabase() {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

async function runScenario(ops: Op[]) {
  await resetDatabase()
  const suppliers: User[] = [
    await UserFactory.apply('supplier').create(),
    await UserFactory.apply('supplier').create(),
  ]
  const buyer = await UserFactory.create()
  const boss = await UserFactory.apply('admin').create()
  const category = await CategoryFactory.create()
  const products = [
    await ProductFactory.merge({ categoryId: category.id }).create(),
    await ProductFactory.merge({ categoryId: category.id }).create(),
  ]

  const lots: ModelLot[] = []
  const adjustments: ModelAdjustment[] = []
  /** Model orders: id → lot, newest last. */
  const sold: Array<{ id: number; lot: number; price: number }> = []
  /** origin lot id → the lot that took its stock over in a handover. */
  const heirOf = new Map<number, number>()
  /**
   * Pieces coming back (storno, revert) go to whoever holds the lot's stock now: the lot
   * itself, or — after a handover — the heir's lot, followed through every later handover.
   * The original then gives them up (supplied −q) and the heir's lot receives them.
   */
  const giveBack = (lot: ModelLot, quantity: number) => {
    let holder = lot
    while (heirOf.has(holder.id)) holder = lots.find((l) => l.id === heirOf.get(holder.id))!
    if (holder === lot) {
      lot.left += quantity
      return
    }
    lot.supplied -= quantity
    holder.supplied += quantity
    holder.left += quantity
  }
  const log: string[] = []

  for (const op of ops) {
    log.push(JSON.stringify(op))
    const fail = (message: string) => {
      throw new Error(`${message}\nafter:\n${log.join('\n')}`)
    }

    if (op.kind === 'lot') {
      const created = await Delivery.create({
        supplierId: suppliers[op.supplier].id,
        productId: products[op.product].id,
        amountSupplied: op.amount,
        amountLeft: op.amount,
        amountLost: 0,
        price: op.price,
        purchasePrice: null,
        createdAt: BASE.minus({ hours: op.slot }),
      })
      lots.push({
        id: created.id,
        supplier: op.supplier,
        product: op.product,
        at: BASE.minus({ hours: op.slot }).toMillis(),
        price: op.price,
        supplied: op.amount,
        left: op.amount,
        lost: 0,
        voided: false,
        handedOver: false,
      })
    }

    if (op.kind === 'buy') {
      const queue = fifo(lots, op.product)
      const next = queue.find((l) => l.left > 0)
      const anyLot = lots.find((l) => l.product === op.product)
      if (!anyLot) continue
      // The client names any lot of the product and the price of the lot FIFO sells next:
      // a wrong pick by the service is a PRICE_CHANGED or a lot mismatch below.
      const attempt = orders.purchase(buyer.id, anyLot.id, 'web', next?.price)
      if (!next) {
        const error = await attempt.then(
          () => null,
          (e: Error) => e
        )
        if (error?.message !== 'OUT_OF_STOCK') fail(`expected OUT_OF_STOCK, got ${error}`)
        continue
      }
      const order = await attempt
      if (order.deliveryId !== next.id)
        fail(`bought from #${order.deliveryId}, FIFO says #${next.id}`)
      next.left -= 1
      sold.push({ id: order.id, lot: next.id, price: next.price })
    }

    if (op.kind === 'writeOff') {
      const queue = fifo(lots, op.product)
      const available = queue.reduce((s, l) => s + l.left, 0)
      const attempt = inventory.writeOff(suppliers[op.actor], {
        productId: products[op.product].id,
        quantity: op.quantity,
        reason: 'damaged',
      })
      if (available < op.quantity) {
        const error = await attempt.then(
          () => null,
          (e: Error) => e
        )
        if (error?.message !== 'NOT_ENOUGH_STOCK') fail(`expected NOT_ENOUGH_STOCK, got ${error}`)
        continue
      }
      const rows = await attempt
      const taken = modelTake(queue, op.quantity)
      const got = rows.map((r) => [r.deliveryId, r.quantity])
      const want = taken.map((t) => [t.lot.id, t.quantity])
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        fail(`write-off rows ${JSON.stringify(got)}, model ${JSON.stringify(want)}`)
      }
      rows.forEach((r) =>
        adjustments.push({
          id: r.id,
          lot: r.deliveryId,
          quantity: r.quantity,
          author: op.actor,
          reverted: false,
        })
      )
    }

    if (op.kind === 'count') {
      const queue = fifo(lots, op.product)
      const stock = queue.reduce((s, l) => s + l.left, 0)
      const counted = Math.max(0, stock + op.delta)
      await inventory.commitCount(suppliers[op.actor], {
        scope: 'all',
        items: [{ productId: products[op.product].id, counted }],
      })
      const difference = counted - stock
      if (difference < 0) modelTake(queue, -difference)
      if (difference > 0) {
        const target = modelSurplusLot(queue, op.actor)
        if (target) {
          target.left += difference
          target.lost -= difference
        }
      }
    }

    if (op.kind === 'revert') {
      const open = adjustments.filter((a) => !a.reverted)
      if (open.length === 0) continue
      const adjustment = open[op.pick % open.length]
      const lot = lots.find((l) => l.id === adjustment.lot)!
      const attempt = inventory.revertWriteOff(suppliers[adjustment.author], adjustment.id)
      if (lot.voided) {
        const error = await attempt.then(
          () => null,
          (e: Error) => e
        )
        if (error?.message !== 'DELIVERY_VOIDED') fail(`expected DELIVERY_VOIDED, got ${error}`)
        continue
      }
      await attempt
      adjustment.reverted = true
      lot.lost -= adjustment.quantity
      giveBack(lot, adjustment.quantity)
    }

    if (op.kind === 'storno') {
      if (sold.length === 0) continue
      const [order] = sold.splice(op.pick % sold.length, 1)
      await admin.stornoOrder(order.id, boss.id)
      giveBack(lots.find((l) => l.id === order.lot)!, 1)
    }

    if (op.kind === 'void') {
      const live = lots.filter((l) => !l.voided)
      if (live.length === 0) continue
      const lot = live[op.pick % live.length]
      const untouched =
        !sold.some((o) => o.lot === lot.id) && lot.lost === 0 && lot.left === lot.supplied
      const attempt = deliveries.voidDelivery(suppliers[lot.supplier], lot.id, 'test')
      if (!untouched || lot.handedOver) {
        const error = await attempt.then(
          () => null,
          (e: Error) => e
        )
        const expected = sold.some((o) => o.lot === lot.id)
          ? 'DELIVERY_HAS_ORDERS'
          : !untouched
            ? 'DELIVERY_HAS_ADJUSTMENTS'
            : 'DELIVERY_TRANSFERRED'
        if (error?.message !== expected) fail(`expected ${expected}, got ${error}`)
        continue
      }
      await attempt
      lot.voided = true
      lot.supplied = 0
      lot.left = 0
    }

    if (op.kind === 'correct') {
      const live = lots.filter((l) => !l.voided)
      if (live.length === 0) continue
      const lot = live[op.pick % live.length]
      // Down by `cut`, but never below what is gone (sold + lost) — that is refused.
      const gone = lot.supplied - lot.left
      const amount = lot.supplied - op.cut
      const attempt = deliveries.correctDelivery(suppliers[lot.supplier], lot.id, {
        amount,
        price: op.price,
        reason: 'model',
      })
      const expected =
        amount < gone
          ? 'AMOUNT_BELOW_SOLD'
          : amount === lot.supplied && op.price === lot.price
            ? 'NO_CHANGE'
            : null
      if (expected) {
        const error = await attempt.then(
          () => null,
          (e: Error) => e
        )
        if (error?.message !== expected) fail(`expected ${expected}, got ${error}`)
        continue
      }
      await attempt
      lot.supplied = amount
      lot.left = amount - gone
      if (op.price !== lot.price) {
        // Every purchase from this lot is uninvoiced here, so all of them follow the price.
        sold.filter((o) => o.lot === lot.id).forEach((o) => (o.price = op.price))
      }
      lot.price = op.price
    }

    if (op.kind === 'reprice') {
      const mine = fifo(lots, op.product).filter((l) => l.supplier === op.actor && l.left > 0)
      const attempt = deliveries.repriceRemaining(
        suppliers[op.actor],
        products[op.product].id,
        op.price
      )
      const expected =
        mine.length === 0
          ? 'NOTHING_IN_STOCK'
          : mine.every((l) => l.price === op.price)
            ? 'NO_CHANGE'
            : null
      if (expected) {
        const error = await attempt.then(
          () => null,
          (e: Error) => e
        )
        if (error?.message !== expected) fail(`expected ${expected}, got ${error}`)
        continue
      }
      await attempt
      // What was sold keeps its price.
      mine.forEach((l) => (l.price = op.price))
    }

    if (op.kind === 'transfer') {
      const to = 1 - op.from
      const handed = lots
        .filter((l) => l.supplier === op.from && !l.voided && l.left > 0)
        .sort((a, b) => a.product - b.product || a.at - b.at || a.id - b.id)
      const attempt = deliveries.transferStock(suppliers[op.from].id, suppliers[to].id, boss)
      if (handed.length === 0) {
        const error = await attempt.then(
          () => null,
          (e: Error) => e
        )
        if (error?.message !== 'NOTHING_TO_TRANSFER')
          fail(`expected NOTHING_TO_TRANSFER, got ${error}`)
        continue
      }
      const result = await attempt
      const moved = result.lots.map((m) => [m.fromDeliveryId, m.pieces])
      const want = handed.map((l) => [l.id, l.left])
      if (JSON.stringify(moved) !== JSON.stringify(want)) {
        fail(`handed over ${JSON.stringify(moved)}, model ${JSON.stringify(want)}`)
      }
      for (const [index, origin] of handed.entries()) {
        const pieces = origin.left
        heirOf.set(origin.id, result.lots[index].toDeliveryId)
        lots.push({
          id: result.lots[index].toDeliveryId,
          supplier: to,
          product: origin.product,
          at: origin.at,
          price: origin.price,
          supplied: pieces,
          left: pieces,
          lost: 0,
          voided: false,
          handedOver: true,
        })
        // The original keeps what was sold and written off; found pieces went with the stock.
        origin.lost = Math.max(0, origin.lost)
        origin.supplied = sold.filter((o) => o.lot === origin.id).length + origin.lost
        origin.left = 0
        origin.handedOver = true
      }
    }

    // Reached only when the operation went through (refusals `continue` above).
    executed.set(op.kind, (executed.get(op.kind) ?? 0) + 1)

    // Every lot equals the model, and the books balance.
    const actual = await Delivery.query().orderBy('id', 'asc')
    const got = actual.map((d) => [
      d.id,
      d.amountSupplied,
      d.amountLeft,
      d.amountLost,
      !!d.voidedAt,
    ])
    const want = [...lots]
      .sort((a, b) => a.id - b.id)
      .map((l) => [l.id, l.supplied, l.left, l.lost, l.voided])
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      fail(`lots ${JSON.stringify(got)}\nmodel ${JSON.stringify(want)}`)
    }
    const actualOrders = await db.from('orders').select('id', 'unit_price').orderBy('id', 'asc')
    const gotOrders = actualOrders.map((o) => [Number(o.id), Number(o.unit_price)])
    const wantOrders = [...sold].sort((a, b) => a.id - b.id).map((o) => [o.id, o.price])
    if (JSON.stringify(gotOrders) !== JSON.stringify(wantOrders)) {
      fail(`orders ${JSON.stringify(gotOrders)}\nmodel ${JSON.stringify(wantOrders)}`)
    }
    const violations = await collectStockViolations({ skipOverview: true })
    if (violations.length > 0) fail(violations.join('\n'))
  }

  // The overview (I4) once at the end — it is the slow part.
  const violations = await collectStockViolations()
  if (violations.length > 0) throw new Error(`${violations.join('\n')}\nafter:\n${log.join('\n')}`)
}

test.group('Stock bookkeeping — model-based FIFO (U-I1)', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })
  group.each.teardown(resetDatabase)

  test('random purchases, write-offs, inventories, reverts, storno and voids match the model', async ({
    assert,
  }) => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 4, maxLength: 18 }), runScenario),
      { seed: 20261004, numRuns: 120, endOnFailure: true }
    )
    for (const kind of [
      'lot',
      'buy',
      'writeOff',
      'count',
      'revert',
      'storno',
      'void',
      'correct',
      'reprice',
      'transfer',
    ] as const) {
      assert.isAbove(
        executed.get(kind) ?? 0,
        4,
        `too few successful ${kind} operations: ${JSON.stringify([...executed])}`
      )
    }
  }).timeout(180_000)

  // Hand-picked sequences the generator might reach only rarely — kept as fixed regressions.
  test('lots sharing a timestamp are sold and written off by id', async () => {
    await runScenario([
      { kind: 'lot', product: 0, supplier: 1, slot: 0, amount: 2, price: 11 },
      { kind: 'lot', product: 0, supplier: 0, slot: 0, amount: 2, price: 12 },
      { kind: 'lot', product: 0, supplier: 0, slot: 1, amount: 1, price: 13 },
      { kind: 'buy', product: 0 },
      // Two lots left at 10:00 — the lower id (the 11 Kč one) is sold first.
      { kind: 'buy', product: 0 },
      { kind: 'writeOff', product: 0, actor: 0, quantity: 2 },
      { kind: 'buy', product: 0 },
      { kind: 'buy', product: 0 },
      { kind: 'buy', product: 0 },
    ])
  })

  test('pieces returned after handovers follow the stock to its current holder', async () => {
    await runScenario([
      { kind: 'lot', product: 0, supplier: 0, slot: 2, amount: 5, price: 10 },
      { kind: 'writeOff', product: 0, actor: 0, quantity: 2 },
      { kind: 'buy', product: 0 },
      { kind: 'transfer', from: 0 },
      // Back to supplier 0: a chain origin → heir → heir's heir.
      { kind: 'transfer', from: 1 },
      { kind: 'revert', pick: 0 },
      { kind: 'storno', pick: 0 },
      { kind: 'buy', product: 0 },
      { kind: 'void', pick: 0 },
      { kind: 'count', product: 0, actor: 1, delta: 1 },
    ])
  })

  test('a surplus after a revert and a storno lands where the rules say', async () => {
    await runScenario([
      { kind: 'lot', product: 0, supplier: 0, slot: 2, amount: 3, price: 10 },
      { kind: 'lot', product: 0, supplier: 1, slot: 1, amount: 3, price: 10 },
      { kind: 'lot', product: 0, supplier: 0, slot: 0, amount: 3, price: 10 },
      { kind: 'writeOff', product: 0, actor: 1, quantity: 4 },
      { kind: 'buy', product: 0 },
      { kind: 'revert', pick: 0 },
      { kind: 'storno', pick: 0 },
      { kind: 'count', product: 0, actor: 1, delta: 2 },
      { kind: 'count', product: 0, actor: 0, delta: -6 },
      { kind: 'count', product: 0, actor: 0, delta: 1 },
    ])
  })
})
