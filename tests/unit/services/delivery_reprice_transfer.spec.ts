import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { UserFactory } from '#database/factories/user_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import DeliveryService from '#services/delivery_service'
import OrderService from '#services/order_service'
import InventoryService from '#services/inventory_service'
import FinanceService from '#services/finance_service'
import { isDomainError } from '#services/domain_error'
import Delivery from '#models/delivery'
import DeliveryCorrection from '#models/delivery_correction'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import { settleSideEffects } from '#services/side_effects'
import { assertStockInvariants } from '#tests/helpers/stock_invariants'

const service = new DeliveryService()
const orderService = new OrderService()

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('orders').delete()
  await db.from('invoices').delete()
  await db.from('delivery_corrections').delete()
  await db.from('stock_adjustments').delete()
  await db.from('inventory_count_items').delete()
  await db.from('inventory_counts').delete()
  await db.from('deliveries').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('users').delete()
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

async function product() {
  const category = await CategoryFactory.create()
  return ProductFactory.merge({ categoryId: category.id }).create()
}

async function lot(
  supplierId: number,
  productId: number,
  options: {
    amount?: number
    left?: number
    lost?: number
    price?: number
    purchasePrice?: number | null
    daysAgo?: number
  } = {}
) {
  const amount = options.amount ?? 10
  const created = await DeliveryFactory.merge({
    supplierId,
    productId,
    amountSupplied: amount,
    amountLeft: options.left ?? amount,
    amountLost: options.lost ?? 0,
    price: options.price ?? 20,
    purchasePrice: options.purchasePrice ?? null,
  }).create()
  if (options.daysAgo) {
    await db
      .from('deliveries')
      .where('id', created.id)
      .update({ created_at: DateTime.now().minus({ days: options.daysAgo }).toJSDate() })
    await created.refresh()
  }
  return created
}

/** amount_supplied = left + sold + lost, for every lot. */
async function assertLotsBalance(assert: { equal: (a: unknown, b: unknown, m?: string) => void }) {
  const rows = await db.from('deliveries').select('*')
  for (const row of rows) {
    const counted = await db.from('orders').where('delivery_id', row.id).count('* as n').first()
    const sold = Number(counted?.n ?? 0)
    assert.equal(
      Number(row.amount_supplied),
      Number(row.amount_left) + sold + Number(row.amount_lost),
      `lot #${row.id} does not balance`
    )
  }
}

test.group('DeliveryService.repriceLots', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(async () => {
    await settleSideEffects()
    await cleanAll()
  })

  async function shelf() {
    const supplier = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const p = await product()
    const older = await lot(supplier.id, p.id, { amount: 2, price: 20, daysAgo: 2 })
    const newer = await lot(supplier.id, p.id, { amount: 5, price: 22, daysAgo: 1 })
    const theirs = await lot(colleague.id, p.id, { amount: 6, price: 20 })
    return { supplier, colleague, buyer, p, older, newer, theirs }
  }
  const priceOf = async (id: number) => {
    const reloaded = await Delivery.findOrFail(id)
    return reloaded.price
  }

  test('changes only the chosen lots; what was sold keeps its price', async ({ assert }) => {
    const { supplier, buyer, p, older, newer, theirs } = await shelf()
    const order = await orderService.purchase(buyer.id, older.id, 'web')

    const result = await service.repriceLots(supplier, [{ deliveryId: newer.id, price: 15 }])

    assert.deepEqual(result, {
      lots: [
        {
          deliveryId: newer.id,
          productId: p.id,
          supplierId: supplier.id,
          from: 22,
          to: 15,
          pieces: 5,
        },
      ],
      pieces: 5,
    })
    assert.equal(await priceOf(older.id), 20)
    assert.equal(await priceOf(newer.id), 15)
    assert.equal(await priceOf(theirs.id), 20)
    await order.refresh()
    assert.equal(order.unitPrice, 20)

    const corrections = await DeliveryCorrection.query().where('kind', 'reprice')
    assert.deepEqual(
      corrections.map((c) => [c.deliveryId, c.oldPrice, c.newPrice, c.repricedOrderCount]),
      [[newer.id, 22, 15, 0]]
    )
    const log = await db.from('audit_logs').where('action', 'delivery.repriced').firstOrFail()
    assert.equal(log.user_id, supplier.id)
    assert.isNull(log.target_user_id)
    assert.deepEqual(log.metadata, { productId: p.id, from: [22], to: 15, lots: 1, pieces: 5 })
    await assertStockInvariants(assert)
  })

  test("a supplier cannot touch a colleague's lot — and nothing changes at all", async ({
    assert,
  }) => {
    const { supplier, newer, theirs } = await shelf()
    // The valid line first: the refused one must roll it back too.
    await expectDomainError(
      () =>
        service.repriceLots(supplier, [
          { deliveryId: newer.id, price: 15 },
          { deliveryId: theirs.id, price: 15 },
        ]),
      'FORBIDDEN'
    )
    assert.equal(await priceOf(newer.id), 22)
    assert.equal(await priceOf(theirs.id), 20)
    assert.lengthOf(await DeliveryCorrection.all(), 0)
    assert.lengthOf(await db.from('audit_logs').where('action', 'delivery.repriced'), 0)
  })

  test("an admin may reprice a colleague's lot, and its owner gets one e-mail", async ({
    assert,
  }) => {
    const fakeMailer = mail.fake()
    try {
      const { supplier, colleague, p, newer, older, theirs } = await shelf()
      const admin = await UserFactory.apply('admin').create()

      await service.repriceLots(admin, [
        { deliveryId: older.id, price: 18 },
        { deliveryId: newer.id, price: 18 },
        { deliveryId: theirs.id, price: 25 },
      ])
      assert.deepEqual(await settleSideEffects(), [])

      const sent = fakeMailer.messages.sent()
      assert.lengthOf(
        sent.filter((m) => m.hasTo(supplier.email)),
        1
      )
      assert.lengthOf(
        sent.filter((m) => m.hasTo(colleague.email)),
        1
      )
      assert.isFalse(sent.some((m) => m.hasTo(admin.email)))
      const toSupplier = JSON.stringify(sent.find((m) => m.hasTo(supplier.email))!.toJSON())
      assert.include(toSupplier, p.displayName)
      assert.include(toSupplier, admin.displayName)
      assert.notInclude(toSupplier, 'translation missing')

      const logs = await db.from('audit_logs').where('action', 'delivery.repriced')
      assert.sameMembers(
        logs.map((l) => l.target_user_id),
        [supplier.id, colleague.id]
      )
    } finally {
      mail.restore()
    }
  })

  test('a supplier repricing their own lots e-mails nobody', async ({ assert }) => {
    const fakeMailer = mail.fake()
    try {
      const { supplier, newer } = await shelf()
      await service.repriceLots(supplier, [{ deliveryId: newer.id, price: 15 }])
      assert.deepEqual(await settleSideEffects(), [])
      assert.lengthOf(fakeMailer.messages.sent(), 0)
    } finally {
      mail.restore()
    }
  })

  test('a voided, a sold-out or an unknown lot is refused', async ({ assert }) => {
    const { supplier, p } = await shelf()
    const voided = await lot(supplier.id, p.id, { amount: 3 })
    await service.voidDelivery(supplier, voided.id, 'Duplicate')
    const soldOut = await lot(supplier.id, p.id, { amount: 2, left: 0, lost: 2 })

    await expectDomainError(
      () => service.repriceLots(supplier, [{ deliveryId: voided.id, price: 9 }]),
      'DELIVERY_VOIDED'
    )
    await expectDomainError(
      () => service.repriceLots(supplier, [{ deliveryId: soldOut.id, price: 9 }]),
      'NOTHING_IN_STOCK'
    )
    await expectDomainError(
      () => service.repriceLots(supplier, [{ deliveryId: soldOut.id + 1000, price: 9 }]),
      'DELIVERY_NOT_FOUND'
    )
    assert.lengthOf(await DeliveryCorrection.query().where('kind', 'reprice'), 0)
  })

  test('the price is a whole number of crowns within the limit', async ({ assert }) => {
    const { supplier, newer, older } = await shelf()
    for (const price of [0, -1, 2.5, 100_001]) {
      await expectDomainError(
        () => service.repriceLots(supplier, [{ deliveryId: newer.id, price }]),
        'INVALID_PRICE'
      )
    }
    await expectDomainError(
      () =>
        service.repriceLots(supplier, [
          { deliveryId: newer.id, price: 9 },
          { deliveryId: newer.id, price: 10 },
        ]),
      'DUPLICATE_LOT'
    )
    await service.repriceLots(supplier, [
      { deliveryId: newer.id, price: 1 },
      { deliveryId: older.id, price: 100_000 },
    ])
    assert.equal(await priceOf(newer.id), 1)
    assert.equal(await priceOf(older.id), 100_000)
  })

  test('the same price everywhere is nothing to change', async () => {
    const { supplier, older } = await shelf()
    await expectDomainError(
      () => service.repriceLots(supplier, [{ deliveryId: older.id, price: 20 }]),
      'NO_CHANGE'
    )
  })

  test("the shortcut reprices all my lots — an admin's own only", async ({ assert }) => {
    const { supplier, p, older, newer, theirs } = await shelf()
    const result = await service.repriceRemaining(supplier, p.id, 15)
    assert.sameMembers(
      result.lots.map((l) => l.deliveryId),
      [older.id, newer.id]
    )
    assert.equal(await priceOf(theirs.id), 20)

    const admin = await UserFactory.apply('admin').create()
    await expectDomainError(() => service.repriceRemaining(admin, p.id, 30), 'NOTHING_IN_STOCK')
    assert.equal(await priceOf(theirs.id), 20)
  })
})

test.group('DeliveryService.listLotsInStock', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('lists the lots with pieces in FIFO order, without purchase prices', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const p = await product()
    const newest = await lot(me.id, p.id, { amount: 3, price: 21, purchasePrice: 12 })
    const oldest = await lot(colleague.id, p.id, {
      amount: 4,
      price: 20,
      purchasePrice: 9.9,
      daysAgo: 5,
    })
    await lot(me.id, p.id, { amount: 2, left: 0, lost: 2, daysAgo: 6 })

    const lots = await service.listLotsInStock(me, p.id)
    assert.deepEqual(
      lots.map((l) => [l.deliveryId, l.amountLeft, l.price, l.mine, l.editable]),
      [
        [oldest.id, 4, 20, false, false],
        [newest.id, 3, 21, true, true],
      ]
    )
    assert.equal(lots[0].supplier.name, colleague.displayName)
    assert.notInclude(JSON.stringify(lots), 'purchase')

    const admin = await UserFactory.apply('admin').create()
    const asAdmin = await service.listLotsInStock(admin, p.id)
    assert.isTrue(asAdmin.every((l) => l.editable && !l.mine))
  })
})

test.group('DeliveryService.transferStock', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('splits every lot: sales stay, the remaining pieces move at the same prices', async ({
    assert,
  }) => {
    const leaving = await UserFactory.apply('supplier').create()
    const heir = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const p = await product()
    const q = await product()
    const first = await lot(leaving.id, p.id, {
      amount: 10,
      price: 20,
      purchasePrice: 14.9,
      daysAgo: 5,
    })
    const second = await lot(leaving.id, q.id, { amount: 4, price: 30, daysAgo: 4 })
    // Gone entirely (written off) — nothing to hand over.
    const empty = await lot(leaving.id, p.id, {
      amount: 2,
      left: 0,
      lost: 2,
      price: 20,
      daysAgo: 6,
    })
    await orderService.purchase(buyer.id, first.id, 'web')
    await orderService.purchase(buyer.id, first.id, 'web')
    await new InventoryService().writeOff(leaving, {
      productId: p.id,
      quantity: 1,
      reason: 'damaged',
    })

    const result = await service.transferStock(leaving.id, heir.id, admin)

    assert.equal(result.pieces, 7 + 4)
    assert.lengthOf(result.lots, 2)

    await first.refresh()
    // 10 supplied: 2 sold, 1 written off stay; 7 left move.
    assert.equal(first.amountSupplied, 3)
    assert.equal(first.amountLeft, 0)
    assert.equal(first.amountLost, 1)
    await second.refresh()
    assert.equal(second.amountSupplied, 0)
    assert.equal(second.amountLeft, 0)
    await empty.refresh()
    assert.equal(empty.amountSupplied, 2)

    const handed = await Delivery.query().where('supplierId', heir.id).orderBy('productId')
    const byProduct = new Map(handed.map((d) => [d.productId, d]))
    const pLot = byProduct.get(p.id)!
    assert.equal(pLot.amountSupplied, 7)
    assert.equal(pLot.amountLeft, 7)
    assert.equal(pLot.price, 20)
    assert.equal(pLot.purchasePrice, 14.9)
    // Keeps its place in the FIFO queue.
    assert.equal(pLot.createdAt.toMillis(), first.createdAt.toMillis())
    assert.equal(byProduct.get(q.id)!.amountLeft, 4)

    await assertLotsBalance(assert)

    const logs = await db.from('audit_logs').where('action', 'delivery.transferred')
    assert.sameMembers(
      logs.map((l) => l.target_user_id),
      [leaving.id, heir.id]
    )
    assert.isTrue(logs.every((l) => l.user_id === admin.id && l.metadata.pieces === 11))
  })

  test('the moved stock is sold before newer lots, and each side keeps its own money', async ({
    assert,
  }) => {
    const leaving = await UserFactory.apply('supplier').create()
    const heir = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const p = await product()
    const old = await lot(leaving.id, p.id, {
      amount: 5,
      price: 20,
      purchasePrice: 10,
      daysAgo: 10,
    })
    await orderService.purchase(buyer.id, old.id, 'web')
    // The heir already stocked the product later.
    const heirsOwn = await lot(heir.id, p.id, { amount: 5, price: 25, daysAgo: 1 })

    await service.transferStock(leaving.id, heir.id, admin)

    // The next purchase comes from the handed-over (older) pieces, not the heir's newer lot.
    const next = await orderService.purchase(buyer.id, heirsOwn.id, 'web', 20)
    await next.load('delivery')
    assert.equal(next.delivery.supplierId, heir.id)
    assert.notEqual(next.deliveryId, heirsOwn.id)
    assert.equal(next.unitPrice, 20)

    const year = DateTime.now().year
    const finance = new FinanceService()
    const before = await finance.getSummary(leaving.id, year, 0)
    const after = await finance.getSummary(heir.id, year, 0)
    // The sale before the handover stays with the leaving supplier, the one after is the heir's.
    assert.equal(before.unitsSold, 1)
    assert.equal(before.revenue, 20)
    assert.equal(after.unitsSold, 1)
    assert.equal(after.revenue, 20)
    assert.equal(after.costOfSales, 10)
    await assertLotsBalance(assert)
  })

  test('found pieces move with the stock and every lot still balances', async ({ assert }) => {
    const leaving = await UserFactory.apply('supplier').create()
    const heir = await UserFactory.apply('admin').create()
    const p = await product()
    const fresh = await lot(leaving.id, p.id, { amount: 10, price: 20 })
    // An inventory found one piece on the untouched lot: supplied 10, left 11, lost -1.
    await db.from('deliveries').where('id', fresh.id).update({ amount_left: 11, amount_lost: -1 })

    const result = await service.transferStock(leaving.id, heir.id, heir)
    assert.equal(result.pieces, 11)
    await fresh.refresh()
    assert.equal(fresh.amountSupplied, 0)
    assert.equal(fresh.amountLost, 0)
    await assertLotsBalance(assert)
  })

  test('the heir must be an active supplier or admin, and there must be stock', async () => {
    const leaving = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const customer = await UserFactory.create()
    const disabled = await UserFactory.apply('supplier').merge({ isDisabled: true }).create()
    const p = await product()

    await expectDomainError(
      () => service.transferStock(leaving.id, leaving.id, admin),
      'TRANSFER_SAME_USER'
    )
    await lot(leaving.id, p.id, { amount: 3 })
    for (const target of [customer, disabled]) {
      await expectDomainError(
        () => service.transferStock(leaving.id, target.id, admin),
        'TRANSFER_TARGET_INVALID'
      )
    }
    const empty = await UserFactory.apply('supplier').create()
    await expectDomainError(
      () => service.transferStock(empty.id, admin.id, admin),
      'NOTHING_TO_TRANSFER'
    )
  })
})

test.group('DeliveryService.openBusinessOf', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('counts stock left and uninvoiced purchases, nothing else', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const p = await product()

    assert.deepEqual(await service.openBusinessOf(supplier.id), {
      lotsWithStock: 0,
      piecesLeft: 0,
      uninvoicedOrders: 0,
    })

    const a = await lot(supplier.id, p.id, { amount: 3 })
    await lot(supplier.id, p.id, { amount: 2, left: 0 })
    const voided = await lot(supplier.id, p.id, { amount: 4 })
    await service.voidDelivery(supplier, voided.id, 'Duplicate')
    await orderService.purchase(buyer.id, a.id, 'web')

    assert.deepEqual(await service.openBusinessOf(supplier.id), {
      lotsWithStock: 1,
      piecesLeft: 2,
      uninvoicedOrders: 1,
    })
  })
})

test.group('DeliveryService — handover records and my remaining stock', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a handover links the new lot to the old one and records it on both', async ({ assert }) => {
    const leaving = await UserFactory.apply('supplier').create()
    const heir = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const p = await product()
    const old = await lot(leaving.id, p.id, { amount: 10, left: 6, lost: 4 })

    const result = await service.transferStock(leaving.id, heir.id, admin)
    const [moved] = result.lots
    const handed = await Delivery.findOrFail(moved.toDeliveryId)
    assert.equal(handed.transferredFromId, old.id)

    const records = await DeliveryCorrection.query().where('kind', 'transfer').orderBy('id')
    assert.deepEqual(
      records.map((c) => [c.deliveryId, c.oldAmountSupplied, c.newAmountSupplied, c.actorId]),
      [
        [old.id, 10, 4, admin.id],
        [handed.id, 0, 6, admin.id],
      ]
    )
  })

  test('myRemaining and currentPrice cover my lots, or every lot for an admin', async ({
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const p = await product()
    await lot(me.id, p.id, { amount: 3, price: 18, daysAgo: 3 })
    await lot(me.id, p.id, { amount: 2, left: 0, lost: 2, price: 99, daysAgo: 1 })
    await lot(colleague.id, p.id, { amount: 5, price: 21 })

    const asSupplier = await service.getStockForSupplier(me.id, 1, 20, { scope: 'all' })
    assert.equal(asSupplier.data[0].totalRemaining, 8)
    assert.equal(asSupplier.data[0].myRemaining, 3)
    // My newest lot that still has pieces — not the sold-out one, not the colleague's.
    assert.equal(asSupplier.data[0].currentPrice, 18)

    const asAdmin = await service.getStockForSupplier(me.id, 1, 20, {
      scope: 'all',
      viewerIsAdmin: true,
    })
    assert.equal(asAdmin.data[0].myRemaining, 8)
    assert.equal(asAdmin.data[0].currentPrice, 21)

    const stranger = await UserFactory.apply('supplier').create()
    const none = await service.getStockForSupplier(stranger.id, 1, 20, { scope: 'all' })
    assert.isNull(none.data[0].currentPrice)
  })
})

test.group('DeliveryService.voidDelivery inside a caller transaction', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('several voids commit or roll back together, audit included', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const p = await product()
    // The older lot is sold from first (FIFO).
    const sold = await lot(supplier.id, p.id, { amount: 3, daysAgo: 2 })
    const first = await lot(supplier.id, p.id, { amount: 3 })
    await orderService.purchase(buyer.id, sold.id, 'web')

    // The second void fails — the first must not stay voided.
    await expectDomainError(
      () =>
        db.transaction(async (trx) => {
          await service.voidDelivery(supplier, first.id, 'Whole draft', { client: trx })
          await service.voidDelivery(supplier, sold.id, 'Whole draft', { client: trx })
        }),
      'DELIVERY_HAS_ORDERS'
    )
    const reloaded = await Delivery.findOrFail(first.id)
    assert.isNull(reloaded.voidedAt)
    assert.lengthOf(await db.from('audit_logs').where('action', 'delivery.voided'), 0)

    const other = await lot(supplier.id, p.id, { amount: 2 })
    const result = await db.transaction((trx) =>
      service.voidDelivery(supplier, other.id, 'Whole draft', { client: trx })
    )
    assert.isNotNull(result.delivery.voidedAt)
    assert.lengthOf(await db.from('audit_logs').where('action', 'delivery.voided'), 1)
  })
})

test.group('DeliveryService — handed-over lots stay real stock', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('neither side of a handover can be voided', async ({ assert }) => {
    const leaving = await UserFactory.apply('supplier').create()
    const heir = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const p = await product()
    const original = await lot(leaving.id, p.id, { amount: 5 })
    const { lots } = await service.transferStock(leaving.id, heir.id, admin)

    // The heir's lot: 5 real pieces. The original: emptied by the handover, nothing sold.
    await expectDomainError(
      () => service.voidDelivery(heir, lots[0].toDeliveryId, 'oops'),
      'DELIVERY_TRANSFERRED'
    )
    await expectDomainError(
      () => service.voidDelivery(admin, original.id, 'oops'),
      'DELIVERY_TRANSFERRED'
    )
    const handed = await Delivery.findOrFail(lots[0].toDeliveryId)
    assert.isNull(handed.voidedAt)
    assert.equal(handed.amountLeft, 5)
  })

  test('returned pieces go back to the lot, or on to whoever took its stock over', async ({
    assert,
  }) => {
    const a = await UserFactory.apply('supplier').create()
    const b = await UserFactory.apply('supplier').create()
    const c = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const p = await product()
    const original = await lot(a.id, p.id, { amount: 4 })
    const order = await orderService.purchase(buyer.id, original.id, 'web')

    // Never handed over: the piece simply returns.
    const other = await product()
    const plain = await lot(a.id, other.id, { amount: 2, left: 1, lost: 1 })
    await db.transaction(async (trx) => {
      await trx.from('deliveries').where('id', plain.id).update({ amount_lost: 0 })
      const target = await service.returnPieces(plain.id, 1, trx)
      assert.equal(target.id, plain.id)
    })
    await plain.refresh()
    assert.deepInclude(plain.serialize(), { amountSupplied: 2, amountLeft: 2, amountLost: 0 })

    // A → B → C: the order's piece ends up on C's lot.
    const first = await service.transferStock(a.id, b.id, admin)
    const second = await service.transferStock(b.id, c.id, admin)
    await db.transaction(async (trx) => {
      await trx.from('orders').where('id', order.id).delete()
      const target = await service.returnPieces(original.id, 1, trx)
      assert.equal(target.id, second.lots[0].toDeliveryId)
    })
    await original.refresh()
    // Nothing sold any more: the original lot is empty.
    assert.equal(original.amountSupplied, 0)
    assert.equal(original.amountLeft, 0)
    const middle = await Delivery.findOrFail(first.lots[0].toDeliveryId)
    assert.equal(middle.amountLeft, 0)
    const last = await Delivery.findOrFail(second.lots[0].toDeliveryId)
    assert.deepInclude(last.serialize(), { amountSupplied: 4, amountLeft: 4, supplierId: c.id })
    await assertLotsBalance(assert)
  })
})

test.group('Buying after a handover', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a kiosk basket naming the handed-over lot buys from the heir lot', async ({ assert }) => {
    const leaving = await UserFactory.apply('supplier').create()
    const heir = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const p = await product()
    // The basket was built before the handover: it names the leaver's lot.
    const original = await lot(leaving.id, p.id, { amount: 4, price: 20 })
    const { lots } = await service.transferStock(leaving.id, heir.id, admin)
    const heirLot = lots[0].toDeliveryId

    const placed = await orderService.purchaseBasket(
      buyer.id,
      [{ deliveryId: original.id, quantity: 2, expectedPrice: 20 }],
      'kiosk'
    )
    assert.deepEqual(
      placed.map((o) => o.deliveryId),
      [heirLot, heirLot]
    )
    const reloaded = await Delivery.findOrFail(heirLot)
    assert.equal(reloaded.amountLeft, 2)
    await assertLotsBalance(assert)

    // A single purchase naming the old lot goes the same way (FIFO).
    const single = await orderService.purchase(buyer.id, original.id, 'web', 20)
    assert.equal(single.deliveryId, heirLot)
  })

  test('a basket still refuses a lot that is simply sold out', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const p = await product()
    const empty = await lot(supplier.id, p.id, { amount: 2, left: 0, lost: 2 })
    await assert.rejects(
      () => orderService.purchaseBasket(buyer.id, [{ deliveryId: empty.id, quantity: 1 }], 'kiosk'),
      'OUT_OF_STOCK'
    )
  })
})

test.group('DeliveryService.getStockForSupplier — mixed stock (PLAN4 P2)', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a row says how many are mine and how many the whole fridge has', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const p = await product()
    const alone = await product()
    await lot(me.id, p.id, { amount: 3 })
    await lot(colleague.id, p.id, { amount: 5 })
    await lot(colleague.id, alone.id, { amount: 4 })

    const all = await service.getStockForSupplier(me.id, 1, 20, { scope: 'all' })
    const shared = all.data.find((row) => row.productId === p.id)!
    assert.deepInclude(shared, { totalRemaining: 8, ownRemaining: 3, totalRemainingAll: 8 })
    const theirs = all.data.find((row) => row.productId === alone.id)!
    assert.deepInclude(theirs, { totalRemaining: 4, ownRemaining: 0, totalRemainingAll: 4 })

    // "Jen moje": my 3 pieces, and the whole fridge still knows there are 8.
    const mine = await service.getStockForSupplier(me.id, 1, 20, { scope: 'mine' })
    assert.lengthOf(mine.data, 1)
    assert.deepInclude(mine.data[0], { totalRemaining: 3, ownRemaining: 3, totalRemainingAll: 8 })

    // An admin's "mine" for repricing is every lot, but their own pieces stay their own.
    const admin = await UserFactory.apply('admin').create()
    const asAdmin = await service.getStockForSupplier(admin.id, 1, 20, {
      scope: 'all',
      viewerIsAdmin: true,
    })
    const row = asAdmin.data.find((r) => r.productId === p.id)!
    assert.deepInclude(row, { myRemaining: 8, ownRemaining: 0, totalRemainingAll: 8 })
  })
})
