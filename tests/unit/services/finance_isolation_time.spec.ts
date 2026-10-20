import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime, Settings } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import env from '#start/env'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Delivery from '#models/delivery'
import Invoice from '#models/invoice'
import type User from '#models/user'
import FinanceService from '#services/finance_service'
import InventoryService from '#services/inventory_service'
import InvoiceService from '#services/invoice_service'
import DeliveryService from '#services/delivery_service'
import OrderService from '#services/order_service'
import AdminService from '#services/admin_service'
import { assertStockInvariants } from '#tests/helpers/stock_invariants'

/**
 * The supplier's money — what other suppliers do never reaches it, calendar years are cut at
 * the fridge's midnight, the yearly limit flips at its exact boundaries, and a handover of
 * stock leaves each side its own money. Expected values are worked out by hand in comments.
 */

const finance = new FinanceService()
const inventory = new InventoryService()

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

async function product(name?: string) {
  const category = await CategoryFactory.create()
  return ProductFactory.merge({
    categoryId: category.id,
    ...(name && { displayName: name }),
  }).create()
}

async function lot(
  supplier: User,
  productId: number,
  options: {
    amount: number
    left?: number
    price: number
    purchasePrice: number | null
    at?: DateTime
  }
) {
  return Delivery.create({
    supplierId: supplier.id,
    productId,
    amountSupplied: options.amount,
    amountLeft: options.left ?? options.amount,
    amountLost: 0,
    price: options.price,
    purchasePrice: options.purchasePrice,
    ...(options.at && { createdAt: options.at }),
  })
}

/** Inserts sales straight into `orders` (no stock bookkeeping — set `left` on the lot). */
async function sell(deliveryId: number, buyerId: number, count: number, price: number, at: Date) {
  await db.table('orders').multiInsert(
    Array.from({ length: count }, () => ({
      buyer_id: buyerId,
      delivery_id: deliveryId,
      channel: 'web',
      unit_price: price,
      created_at: at,
      updated_at: at,
    }))
  )
}

test.group('FinanceService — one supplier never sees another', (group) => {
  let previousLimit: number | undefined
  group.each.setup(async () => {
    previousLimit = env.get('SUPPLIER_INCOME_LIMIT')
    await cleanAll()
  })
  group.each.teardown(async () => {
    env.set('SUPPLIER_INCOME_LIMIT', previousLimit ?? 0)
    await cleanAll()
  })

  // Mutations caught: dropping the supplier filter of the sales query, of the adjustments
  // query, of either breakdown CTE, of receivedIn or owedNow (QA-01, U-F1).
  test("another supplier's sales, losses, surplus and payments never reach my numbers", async ({
    assert,
  }) => {
    env.set('SUPPLIER_INCOME_LIMIT', 100)
    const a = await UserFactory.apply('supplier').create()
    const b = await UserFactory.apply('supplier').create()
    const c = await UserFactory.create()
    const cola = await product()
    const chips = await product()
    const now = new Date()

    // B stocked the cola first, so FIFO write-offs land on B's lot.
    const bLot = await lot(b, cola.id, {
      amount: 10,
      left: 4,
      price: 25,
      purchasePrice: 20,
      at: DateTime.now().minus({ hours: 2 }),
    })
    const aLot = await lot(a, cola.id, {
      amount: 10,
      left: 6,
      price: 12,
      purchasePrice: 10,
      at: DateTime.now().minus({ hours: 1 }),
    })
    await lot(a, chips.id, { amount: 5, price: 8, purchasePrice: 6 })

    // A's lot: C buys 3, B (a colleague) buys 1 → A sold 4 pieces for 4 × 12 = 48.
    await sell(aLot.id, c.id, 3, 12, now)
    await sell(aLot.id, b.id, 1, 12, now)
    // B's lot: C buys 5, A buys 1 → B's sales, A's own purchase from a colleague is no income.
    await sell(bLot.id, c.id, 5, 25, now)
    await sell(bLot.id, a.id, 1, 25, now)
    // B writes 2 off (FIFO: B's older lot), then an inventory finds 1 more (B's newest lot).
    await inventory.writeOff(b, { productId: cola.id, quantity: 2, reason: 'stolen' })
    await inventory.commitCount(b, {
      scope: 'all',
      items: [{ productId: cola.id, counted: 2 + 6 + 1 }],
    })
    // A loses one bag of chips: 1 × 6 at cost, 1 × 8 at selling price.
    await inventory.writeOff(a, { productId: chips.id, quantity: 1, reason: 'damaged' })
    // B was paid 125 by C today; that money is B's alone.
    const paid = await Invoice.create({
      buyerId: c.id,
      supplierId: b.id,
      totalCost: 125,
      isPaid: true,
      isPaymentRequested: true,
      paidAt: DateTime.now(),
    })
    await db.from('orders').where('delivery_id', bLot.id).where('buyer_id', c.id).update({
      invoice_id: paid.id,
    })

    const mine = await finance.getSummary(a.id, finance.currentYear(), 0)
    assert.deepInclude(mine, {
      unitsSold: 4,
      revenue: 48,
      unitsWithCost: 4,
      revenueWithCost: 48,
      costOfSales: 40, // 4 × 10
      grossProfit: 8,
      unitsWithoutCost: 0,
      netProfit: 2, // 8 − the lost bag at cost 6
    })
    assert.deepEqual(mine.ownConsumption, { units: 0, value: 0 })
    assert.deepInclude(mine.shrinkage, {
      lostUnits: 1,
      surplusUnits: 0,
      surplusCost: 0,
      lossCost: 6,
      lossValue: 8,
      lossRate: 0.2, // 1 lost of 4 sold + 0 eaten + 1 lost
    })
    assert.deepEqual(mine.shrinkage.byReason, [
      { reason: 'damaged', lostUnits: 1, lossCost: 6, lossValue: 8 },
    ])
    // Purchased: 10 × 10 + 5 × 6; on the shelf at cost: 6 × 10 + 4 × 6; C and B owe 48.
    assert.deepEqual(mine.money, {
      purchased: 130,
      stockAtCost: 84,
      stockUnitsWithoutCost: 0,
      uninvoiced: 48,
      unpaid: 0,
    })
    assert.deepInclude(mine.incomeLimit, { amount: 0, pending: 48, level: 'ok' })
    assert.deepInclude((await finance.currentLimitStatus(a.id))!, {
      amount: 0,
      pending: 48,
      level: 'ok',
    })

    const breakdown = await finance.getProductBreakdown(a.id, finance.currentYear(), 1, 20, {})
    assert.equal(breakdown.meta.total, 2)
    assert.deepEqual(
      breakdown.data.map((row) => [row.productId, row.unitsSold, row.revenue, row.lostUnits]),
      [
        [cola.id, 4, 48, 0],
        [chips.id, 0, 0, 1],
      ]
    )

    // And B's own view is B's: 6 sold (5 to C, 1 to A) for 150, 2 lost, 1 found, 125 received.
    const theirs = await finance.getSummary(b.id, finance.currentYear(), 0)
    assert.deepInclude(theirs, { unitsSold: 6, revenue: 150, costOfSales: 120 })
    assert.deepInclude(theirs.shrinkage, { lostUnits: 2, surplusUnits: 1 })
    assert.deepInclude(theirs.incomeLimit, { amount: 125, pending: 25, level: 'exceeded' })
  })
})

test.group('FinanceService — calendar years in the fridge timezone', (group) => {
  let previousZone: typeof Settings.defaultZone
  group.each.setup(async () => {
    // A server whose clock runs on another continent must not move the tax year.
    previousZone = Settings.defaultZone
    Settings.defaultZone = 'America/Los_Angeles'
    await cleanAll()
  })
  group.each.teardown(async () => {
    Settings.defaultZone = previousZone
    await cleanAll()
  })

  // Mutation caught: building the year range without `{ zone: FRIDGE_TIMEZONE }` (U-F2).
  test('a sale, a loss and a payment at 00:30 on New Year in Prague belong to the new year', async ({
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const cola = await product()
    const year = finance.currentYear() - 2
    // Winter: Prague is UTC+1. 22:30Z = 23:30 on 31 Dec, 23:30Z = 00:30 on 1 Jan.
    const lastHour = new Date(Date.UTC(year, 11, 31, 22, 30))
    const firstHour = new Date(Date.UTC(year, 11, 31, 23, 30))
    const delivery = await lot(supplier, cola.id, {
      amount: 10,
      left: 6,
      price: 20,
      purchasePrice: 15,
      at: DateTime.fromJSDate(new Date(Date.UTC(year, 5, 1))),
    })
    await sell(delivery.id, buyer.id, 1, 20, lastHour)
    await sell(delivery.id, buyer.id, 1, 20, firstHour)
    await db.table('stock_adjustments').multiInsert(
      [lastHour, firstHour, firstHour].map((at) => ({
        delivery_id: delivery.id,
        product_id: cola.id,
        supplier_id: supplier.id,
        actor_id: supplier.id,
        kind: 'loss',
        reason: 'expired',
        quantity: 1,
        unit_cost: 15,
        unit_price: 20,
        created_at: at,
      }))
    )
    for (const [totalCost, paidAt] of [
      [20, lastHour],
      [20, firstHour],
    ] as const) {
      await Invoice.create({
        buyerId: buyer.id,
        supplierId: supplier.id,
        totalCost,
        isPaid: true,
        isPaymentRequested: true,
        paidAt: DateTime.fromJSDate(paidAt),
      })
    }

    const before = await finance.getSummary(supplier.id, year, 0)
    const after = await finance.getSummary(supplier.id, year + 1, 0)
    assert.deepEqual(
      [before.unitsSold, before.revenue, before.shrinkage.lostUnits],
      [1, 20, 1],
      'the last hour of December'
    )
    assert.deepEqual(
      [after.unitsSold, after.revenue, after.shrinkage.lostUnits],
      [1, 20, 2],
      'the first hour of January'
    )
    assert.equal(await finance.receivedIn(supplier.id, year), 20)
    assert.equal(await finance.receivedIn(supplier.id, year + 1), 20)

    const breakdown = await finance.getProductBreakdown(supplier.id, year + 1, 1, 20, {})
    assert.deepEqual(
      breakdown.data.map((row) => [row.unitsSold, row.lostUnits]),
      [[1, 2]]
    )
  })

  test('the year list starts at the Prague year of the first lot', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const cola = await product()
    const current = finance.currentYear()
    // 23:30Z on 31 Dec two years back is already 1 Jan of last year in Prague.
    await lot(supplier, cola.id, {
      amount: 1,
      price: 10,
      purchasePrice: null,
      at: DateTime.fromJSDate(new Date(Date.UTC(current - 2, 11, 31, 23, 30))),
    })
    assert.deepEqual(await finance.yearOptions(supplier.id), [current, current - 1])
  })
})

test.group('FinanceService — the yearly limit at its boundaries', (group) => {
  let previousLimit: number | undefined
  let previousWarn: number | undefined
  group.each.setup(() => {
    previousLimit = env.get('SUPPLIER_INCOME_LIMIT')
    previousWarn = env.get('SUPPLIER_INCOME_LIMIT_WARN_PERCENT')
  })
  group.each.teardown(() => {
    env.set('SUPPLIER_INCOME_LIMIT', previousLimit ?? 0)
    env.set('SUPPLIER_INCOME_LIMIT_WARN_PERCENT', previousWarn ?? 80)
  })

  // Mutations caught: `>=` → `>` on either level (QA-11), warn from the limit instead of the
  // configured share, a non-positive limit treated as enabled.
  test('ok below the warning share, warn from it, exceeded from the limit itself', ({ assert }) => {
    env.set('SUPPLIER_INCOME_LIMIT', 1000)
    env.set('SUPPLIER_INCOME_LIMIT_WARN_PERCENT', 80)
    const levels = [0, 799, 800, 999, 1000, 1001].map((received) => [
      received,
      finance.limitStatus(received).level,
    ])
    assert.deepEqual(levels, [
      [0, 'ok'],
      [799, 'ok'],
      [800, 'warn'],
      [999, 'warn'],
      [1000, 'exceeded'],
      [1001, 'exceeded'],
    ])

    env.set('SUPPLIER_INCOME_LIMIT_WARN_PERCENT', 90)
    assert.equal(finance.limitStatus(899).level, 'ok')
    assert.equal(finance.limitStatus(900).level, 'warn')

    for (const off of [0, -5]) {
      env.set('SUPPLIER_INCOME_LIMIT', off)
      assert.deepInclude(finance.limitStatus(5000), { enabled: false, level: 'ok', limit: 0 })
    }
  })

  // Regression: the level came from the percentage rounded to 0.1 %, so 9 995 of 10 000 read
  // "exceeded" with 5 Kč left (1 000 Kč early at a 2 000 000 Kč limit). The percentage shown
  // must not claim 100 % before the limit is reached either.
  test('the level is decided on the exact amount, not on the rounded percentage', ({ assert }) => {
    env.set('SUPPLIER_INCOME_LIMIT', 10_000)
    env.set('SUPPLIER_INCOME_LIMIT_WARN_PERCENT', 80)
    assert.deepInclude(finance.limitStatus(9995), { level: 'warn', percent: 99.9 })
    assert.equal(finance.limitStatus(7995).level, 'ok')
    assert.equal(finance.limitStatus(10_000).level, 'exceeded')
  })
})

test.group('FinanceService — breakdown sorting and paging', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  // Mutations caught: a wrong alias in SORT_COLUMNS, ignoring sortOrder, dropping the
  // product-name tie-breaker, passing an unknown sortBy into ORDER BY (U-F6).
  test('every whitelisted column sorts both ways; ties go by name; anything else is revenue desc', async ({
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const now = new Date()
    // name    sold  revenue  profit        lost
    // Alpha   1     30       30 − 10 = 20  2
    // Beta    3     30       30 − 27 = 3   0
    // Gamma   2     50       50 − 10 = 40  1
    const plan = [
      // Beta is stocked first, so the table order alone would not put Alpha ahead of it.
      { name: 'Beta', sold: 3, price: 10, cost: 9, lost: 0 },
      { name: 'Alpha', sold: 1, price: 30, cost: 10, lost: 2 },
      { name: 'Gamma', sold: 2, price: 25, cost: 5, lost: 1 },
    ]
    for (const row of plan) {
      const p = await product(row.name)
      const l = await lot(supplier, p.id, {
        amount: 10,
        left: 10 - row.sold,
        price: row.price,
        purchasePrice: row.cost,
      })
      await sell(l.id, buyer.id, row.sold, row.price, now)
      if (row.lost) {
        await inventory.writeOff(supplier, { productId: p.id, quantity: row.lost, reason: 'other' })
      }
    }
    const order = async (sortBy: string, sortOrder?: string) => {
      const { data } = await finance.getProductBreakdown(
        supplier.id,
        finance.currentYear(),
        1,
        20,
        {
          sortBy,
          sortOrder,
        }
      )
      return data.map((row) => row.productName)
    }

    assert.deepEqual(await order('productName', 'asc'), ['Alpha', 'Beta', 'Gamma'])
    assert.deepEqual(await order('productName', 'desc'), ['Gamma', 'Beta', 'Alpha'])
    assert.deepEqual(await order('unitsSold', 'asc'), ['Alpha', 'Gamma', 'Beta'])
    assert.deepEqual(await order('unitsSold', 'desc'), ['Beta', 'Gamma', 'Alpha'])
    assert.deepEqual(await order('revenue', 'asc'), ['Alpha', 'Beta', 'Gamma'])
    // The 30/30 tie stays in name order whichever way revenue runs.
    assert.deepEqual(await order('revenue', 'desc'), ['Gamma', 'Alpha', 'Beta'])
    assert.deepEqual(await order('grossProfit', 'asc'), ['Beta', 'Alpha', 'Gamma'])
    assert.deepEqual(await order('grossProfit', 'desc'), ['Gamma', 'Alpha', 'Beta'])
    assert.deepEqual(await order('lostUnits', 'asc'), ['Beta', 'Gamma', 'Alpha'])
    assert.deepEqual(await order('lostUnits', 'desc'), ['Alpha', 'Gamma', 'Beta'])
    assert.deepEqual(await order('product_name; DROP TABLE orders', 'asc; --'), [
      'Gamma',
      'Alpha',
      'Beta',
    ])

    // One per page walks the same order without repeating or skipping anyone.
    const pages: string[] = []
    for (let page = 1; page <= 3; page++) {
      const result = await finance.getProductBreakdown(
        supplier.id,
        finance.currentYear(),
        page,
        1,
        {}
      )
      assert.deepEqual(result.meta, { total: 3, perPage: 1, currentPage: page, lastPage: 3 })
      pages.push(...result.data.map((row) => row.productName))
    }
    assert.deepEqual(pages, ['Gamma', 'Alpha', 'Beta'])
  })
})

test.group('FinanceService — corrected prices and handed-over stock', (group) => {
  group.each.setup(async () => {
    mail.fake()
    await cleanAll()
  })
  group.each.teardown(async () => {
    mail.restore()
    await cleanAll()
  })

  // Mutation caught: revenue summed from deliveries.price instead of orders.unit_price, or a
  // correction that reprices invoiced orders (U-F7).
  test('a price corrected after invoicing: revenue is what the orders really cost', async ({
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const cola = await product()
    const orders = new OrderService()
    const delivery = await lot(supplier, cola.id, { amount: 5, price: 20, purchasePrice: 15 })
    await orders.purchase(buyer.id, delivery.id, 'web')
    await orders.purchase(buyer.id, delivery.id, 'web')
    const [invoice] = await new InvoiceService().generateInvoices(supplier.id)
    await orders.purchase(buyer.id, delivery.id, 'web')

    await new DeliveryService().correctDelivery(supplier, delivery.id, {
      amount: 5,
      price: 25,
      reason: 'typo in the price',
    })

    // Invoiced 2 × 20 stays; the uninvoiced piece now costs 25 → 65.
    const summary = await finance.getSummary(supplier.id, finance.currentYear(), 0)
    assert.equal(summary.revenue, 65)
    assert.equal(summary.costOfSales, 45)
    assert.equal(summary.grossProfit, 20)
    assert.deepInclude(summary.money, { uninvoiced: 25, unpaid: 40 })
    await invoice.refresh()
    assert.equal(invoice.totalCost, 40)
    const invoicedSum = await db
      .from('orders')
      .where('invoice_id', invoice.id)
      .sum('unit_price as total')
      .first()
    assert.equal(Number(invoicedSum.total), invoice.totalCost)
  })

  // Mutations caught: the new lot booked to the leaving supplier, sales or open debts moving
  // with the stock, the old lot keeping its remaining pieces, invoicing after the handover
  // picking up the other side's orders.
  test('a handover moves the stock at cost; sales, debts and invoices stay with whoever sold', async ({
    assert,
  }) => {
    const leaving = await UserFactory.apply('supplier').create()
    const heir = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const cola = await product()
    const orders = new OrderService()
    const invoices = new InvoiceService()
    const year = finance.currentYear()
    const old = await lot(leaving, cola.id, {
      amount: 10,
      price: 20,
      purchasePrice: 12,
      at: DateTime.now().minus({ minutes: 30 }),
    })
    // 3 sold and invoiced (unpaid), 1 sold not invoiced, 1 written off → 5 left.
    for (let i = 0; i < 3; i++) await orders.purchase(buyer.id, old.id, 'web')
    await invoices.generateInvoices(leaving.id)
    await orders.purchase(buyer.id, old.id, 'web')
    await inventory.writeOff(leaving, { productId: cola.id, quantity: 1, reason: 'damaged' })

    const beforeHandover = await finance.getSummary(leaving.id, year, 0)
    const purchasedBefore = beforeHandover.money.purchased
    assert.equal(purchasedBefore, 120) // 10 × 12

    await new DeliveryService().transferStock(leaving.id, heir.id, admin)

    const left = await finance.getSummary(leaving.id, year, 0)
    const took = await finance.getSummary(heir.id, year, 0)
    // The leaving supplier keeps the 4 sales (80, cost 48), the loss and what is owed for them.
    assert.deepInclude(left, { unitsSold: 4, revenue: 80, costOfSales: 48, grossProfit: 32 })
    assert.deepInclude(left.shrinkage, { lostUnits: 1, lossCost: 12 })
    assert.deepInclude(left.money, { stockAtCost: 0, uninvoiced: 20, unpaid: 60 })
    // The heir has 5 pieces at 12 and no sales yet.
    assert.deepInclude(took, { unitsSold: 0, revenue: 0 })
    assert.deepInclude(took.money, { stockAtCost: 60, uninvoiced: 0, unpaid: 0 })
    // The heir bought the 5 remaining pieces off the leaving supplier outside the app
    // (docs/shopping-list.md): 5 × 12 move from one "purchased" to the other, nothing more.
    assert.equal(left.money.purchased, 60) // the 4 sold + 1 written off
    assert.equal(took.money.purchased, 60)
    assert.equal(left.money.purchased + took.money.purchased, purchasedBefore)

    // The heir sells one: it is their sale at the handed-over cost, and their invoice.
    await orders.purchase(buyer.id, old.id, 'web')
    const heirAfterSale = await finance.getSummary(heir.id, year, 0)
    assert.deepInclude(heirAfterSale, { unitsSold: 1, revenue: 20, costOfSales: 12 })
    assert.deepInclude(heirAfterSale.money, { uninvoiced: 20 })
    const leavingAfterSale = await finance.getSummary(leaving.id, year, 0)
    assert.deepInclude(leavingAfterSale.money, { uninvoiced: 20 })

    const leavingInvoices = await invoices.generateInvoices(leaving.id)
    const heirInvoices = await invoices.generateInvoices(heir.id)
    assert.deepEqual(
      leavingInvoices.map((i) => [i.buyerId, i.totalCost]),
      [[buyer.id, 20]]
    )
    assert.deepEqual(
      heirInvoices.map((i) => [i.buyerId, i.totalCost]),
      [[buyer.id, 20]]
    )
    await assertStockInvariants(assert)
  })

  // A piece that comes back after the handover (a storno, a reverted write-off) goes to whoever
  // holds the stock now (DeliveryService.returnPieces), and the money follows it.
  // Mutations caught: the piece put back on the leaving supplier's lot, the cancelled sale
  // still in their revenue or debts, the reverted loss still in their shrinkage.
  test('after a handover, a cancelled sale and a reverted write-off land with the heir', async ({
    assert,
  }) => {
    const leaving = await UserFactory.apply('supplier').create()
    const heir = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const cola = await product()
    const orders = new OrderService()
    const year = finance.currentYear()
    const old = await lot(leaving, cola.id, {
      amount: 10,
      price: 20,
      purchasePrice: 12,
      at: DateTime.now().minus({ minutes: 30 }),
    })
    // 2 sold (not invoiced), 1 written off → 7 handed over.
    const first = await orders.purchase(buyer.id, old.id, 'web')
    await orders.purchase(buyer.id, old.id, 'web')
    const [writeOff] = await inventory.writeOff(leaving, {
      productId: cola.id,
      quantity: 1,
      reason: 'damaged',
    })
    await new DeliveryService().transferStock(leaving.id, heir.id, admin)

    await new AdminService().stornoOrder(first.id, admin.id)
    await inventory.revertWriteOff(leaving, writeOff.id)

    const left = await finance.getSummary(leaving.id, year, 0)
    const took = await finance.getSummary(heir.id, year, 0)
    // The leaving supplier keeps one sale: 20 Kč, owed, at cost 12; no shrinkage any more.
    assert.deepInclude(left, { unitsSold: 1, revenue: 20, costOfSales: 12 })
    assert.deepInclude(left.shrinkage, { lostUnits: 0, lossCost: 0 })
    assert.deepInclude(left.money, { purchased: 12, stockAtCost: 0, uninvoiced: 20, unpaid: 0 })
    // Both pieces came back to the heir: 7 + 2 = 9 on the shelf at 12.
    assert.deepInclude(took, { unitsSold: 0, revenue: 0 })
    assert.deepInclude(took.money, { purchased: 108, stockAtCost: 108, uninvoiced: 0 })
    assert.equal(left.money.purchased + took.money.purchased, 120)
    await assertStockInvariants(assert)
  })
})
