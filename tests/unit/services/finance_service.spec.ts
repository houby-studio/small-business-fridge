import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Delivery from '#models/delivery'
import Invoice from '#models/invoice'
import FinanceService from '#services/finance_service'
import InventoryService from '#services/inventory_service'
import { FRIDGE_TIMEZONE } from '#config/fridge'

const service = new FinanceService()

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

async function sell(
  deliveryId: number,
  buyerId: number,
  count: number,
  price: number,
  when: DateTime
) {
  await db.table('orders').multiInsert(
    Array.from({ length: count }, () => ({
      buyer_id: buyerId,
      delivery_id: deliveryId,
      channel: 'kiosk',
      unit_price: price,
      created_at: when.toJSDate(),
      updated_at: when.toJSDate(),
    }))
  )
}

test.group('FinanceService', (group) => {
  let previousLimit: number | undefined

  group.each.setup(async () => {
    previousLimit = env.get('SUPPLIER_INCOME_LIMIT')
    await cleanAll()
  })
  group.each.teardown(async () => {
    // Env.set writes process.env too, where undefined would become the string "undefined".
    env.set('SUPPLIER_INCOME_LIMIT', previousLimit ?? 0)
    await cleanAll()
  })

  test('profit counts only what has a purchase price; shrinkage comes off it', async ({
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const cola = await ProductFactory.merge({ categoryId: category.id }).create()
    const bar = await ProductFactory.merge({ categoryId: category.id }).create()
    const now = DateTime.now().setZone(FRIDGE_TIMEZONE)

    const colaLot = await Delivery.create({
      supplierId: supplier.id,
      productId: cola.id,
      amountSupplied: 24,
      amountLeft: 12,
      amountLost: 0,
      price: 16,
      purchasePrice: 14.5,
    })
    await sell(colaLot.id, buyer.id, 10, 16, now)
    const barLot = await Delivery.create({
      supplierId: supplier.id,
      productId: bar.id,
      amountSupplied: 10,
      amountLeft: 5,
      amountLost: 0,
      price: 20,
      purchasePrice: null,
    })
    await sell(barLot.id, buyer.id, 5, 20, now)
    // Sold last year — not this year's money.
    await sell(colaLot.id, buyer.id, 2, 16, now.minus({ years: 1 }))
    await new InventoryService().writeOff(supplier, {
      productId: cola.id,
      quantity: 2,
      reason: 'damaged',
    })

    const summary = await service.getSummary(supplier.id, now.year, 0)
    assert.equal(summary.unitsSold, 15)
    assert.equal(summary.revenue, 260)
    assert.equal(summary.unitsWithCost, 10)
    assert.equal(summary.revenueWithCost, 160)
    assert.equal(summary.costOfSales, 145)
    assert.equal(summary.grossProfit, 15)
    assert.equal(summary.unitsWithoutCost, 5)
    assert.equal(summary.achievedMarginPercent, 10.34)
    assert.equal(summary.shrinkage.lostUnits, 2)
    assert.equal(summary.shrinkage.surplusUnits, 0)
    assert.equal(summary.shrinkage.surplusCost, 0)
    assert.equal(summary.shrinkage.lossCost, 29)
    assert.equal(summary.shrinkage.lossValue, 32)
    assert.closeTo(summary.shrinkage.lossRate, 2 / 17, 0.0001)
    assert.equal(summary.netProfit, -14)
    assert.closeTo(summary.breakEvenMarginPercent, 13.33, 0.01)
    assert.isFalse(summary.incomeLimit.enabled)

    const lastYear = await service.getSummary(supplier.id, now.year - 1, 0)
    assert.equal(lastYear.unitsSold, 2)
    assert.equal(lastYear.shrinkage.lostUnits, 0)

    const breakdown = await service.getProductBreakdown(supplier.id, now.year, 1, 20, {
      sortBy: 'revenue',
      sortOrder: 'desc',
    })
    assert.equal(breakdown.meta.total, 2)
    assert.deepEqual(
      breakdown.data.map(
        (row: {
          productId: number
          unitsSold: number
          revenue: number
          grossProfit: number | null
          lostUnits: number
        }) => [row.productId, row.unitsSold, row.revenue, row.grossProfit, row.lostUnits]
      ),
      [
        [cola.id, 10, 160, 15, 2],
        [bar.id, 5, 100, null, 0],
      ]
    )
  })

  test('buying from your own lots is own consumption, not income', async ({ assert }) => {
    env.set('SUPPLIER_INCOME_LIMIT', 100)
    const supplier = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.create()
    const category = await CategoryFactory.create()
    const cola = await ProductFactory.merge({ categoryId: category.id }).create()
    const bar = await ProductFactory.merge({ categoryId: category.id }).create()
    const now = DateTime.now().setZone(FRIDGE_TIMEZONE)

    const colaLot = await Delivery.create({
      supplierId: supplier.id,
      productId: cola.id,
      amountSupplied: 20,
      amountLeft: 10,
      amountLost: 0,
      price: 20,
      purchasePrice: 15,
    })
    await sell(colaLot.id, colleague.id, 4, 20, now)
    await sell(colaLot.id, supplier.id, 6, 20, now)
    const barLot = await Delivery.create({
      supplierId: supplier.id,
      productId: bar.id,
      amountSupplied: 5,
      amountLeft: 2,
      amountLost: 0,
      price: 10,
      purchasePrice: 8,
    })
    // Only ever eaten by the supplier — no sale at all.
    await sell(barLot.id, supplier.id, 3, 10, now)
    await new InventoryService().writeOff(supplier, {
      productId: cola.id,
      quantity: 2,
      reason: 'stolen',
    })

    const summary = await service.getSummary(supplier.id, now.year, 0)
    assert.equal(summary.unitsSold, 4)
    assert.equal(summary.revenue, 80)
    assert.equal(summary.unitsWithCost, 4)
    assert.equal(summary.revenueWithCost, 80)
    assert.equal(summary.costOfSales, 60)
    assert.equal(summary.grossProfit, 20)
    assert.equal(summary.achievedMarginPercent, 33.33)
    assert.equal(summary.unitsWithoutCost, 0)
    assert.deepEqual(summary.ownConsumption, { units: 9, value: 150 })
    // Everything that left the shelf: 4 sold + 9 eaten + 2 lost.
    assert.closeTo(summary.shrinkage.lossRate, 2 / 15, 0.0001)
    assert.equal(summary.shrinkage.lossCost, 30)
    assert.equal(summary.netProfit, -10)
    // 230 Kč went through the till, but only the 80 Kč colleagues paid counts.
    // Nothing is invoiced yet: no money received, the 80 Kč colleagues owe are pending.
    assert.deepInclude(summary.incomeLimit, { enabled: true, amount: 0, pending: 80 })
    assert.notProperty(summary.incomeLimit, 'basis')
    const banner = await service.currentLimitStatus(supplier.id, 0)
    assert.equal(banner?.pending, 80)

    const breakdown = await service.getProductBreakdown(supplier.id, now.year, 1, 20, {})
    assert.equal(breakdown.meta.total, 1)
    const [row] = breakdown.data
    assert.deepEqual(
      [row.productId, row.unitsSold, row.revenue, row.costOfSales, row.grossProfit, row.lostUnits],
      [cola.id, 4, 80, 60, 20, 2]
    )
    // 2 lost out of 4 sold + 6 eaten + 2 lost.
    assert.equal(row.lossRate, 0.167)
  })

  test('shrinkage is broken down by reason; a surplus is reported next to it', async ({
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const cola = await ProductFactory.merge({ categoryId: category.id }).create()
    const water = await ProductFactory.merge({ categoryId: category.id }).create()
    const now = DateTime.now().setZone(FRIDGE_TIMEZONE)
    await Delivery.create({
      supplierId: supplier.id,
      productId: cola.id,
      amountSupplied: 20,
      amountLeft: 20,
      amountLost: 0,
      price: 20,
      purchasePrice: 15,
    })
    await Delivery.create({
      supplierId: supplier.id,
      productId: water.id,
      amountSupplied: 5,
      amountLeft: 5,
      amountLost: 0,
      price: 10,
      purchasePrice: 8,
    })
    const inventory = new InventoryService()
    await inventory.writeOff(supplier, { productId: cola.id, quantity: 1, reason: 'expired' })
    await inventory.writeOff(supplier, { productId: cola.id, quantity: 2, reason: 'stolen' })
    await inventory.commitCount(supplier, {
      scope: 'mine',
      items: [
        { productId: cola.id, expected: 17, counted: 14 },
        { productId: water.id, expected: 5, counted: 6 },
      ],
    })

    const { shrinkage } = await service.getSummary(supplier.id, now.year, 0)
    assert.deepEqual(shrinkage.byReason, [
      { reason: 'inventory', lostUnits: 3, lossCost: 45, lossValue: 60 },
      { reason: 'stolen', lostUnits: 2, lossCost: 30, lossValue: 40 },
      { reason: 'expired', lostUnits: 1, lossCost: 15, lossValue: 20 },
    ])
    // The found water bottle offsets the totals, not the breakdown: reasons − surplus = net.
    assert.equal(shrinkage.lostUnits, 6)
    assert.equal(shrinkage.surplusUnits, 1)
    assert.equal(shrinkage.surplusCost, 8)
    assert.equal(shrinkage.lossCost, 82)
    assert.equal(
      shrinkage.byReason.reduce((sum, row) => sum + row.lossCost, 0) - shrinkage.surplusCost,
      shrinkage.lossCost
    )
    assert.equal(shrinkage.lossValue, 110)
  })

  test('finding more than was lost is not income: shrinkage stops at zero', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const cola = await ProductFactory.merge({ categoryId: category.id }).create()
    const now = DateTime.now().setZone(FRIDGE_TIMEZONE)
    const lot = await Delivery.create({
      supplierId: supplier.id,
      productId: cola.id,
      amountSupplied: 20,
      amountLeft: 18,
      amountLost: 0,
      price: 20,
      purchasePrice: 15,
    })
    await sell(lot.id, buyer.id, 2, 20, now)
    const inventory = new InventoryService()
    await inventory.writeOff(supplier, { productId: cola.id, quantity: 1, reason: 'expired' })
    // Three more on the shelf than the system knew of.
    await inventory.commitCount(supplier, {
      scope: 'all',
      items: [{ productId: cola.id, expected: 17, counted: 20 }],
    })

    const summary = await service.getSummary(supplier.id, now.year, 0)
    assert.deepInclude(summary.shrinkage, {
      lostUnits: 1,
      surplusUnits: 3,
      surplusCost: 45,
      lossCost: 0,
      lossValue: 0,
      lossRate: 0,
    })
    assert.deepEqual(summary.shrinkage.byReason, [
      { reason: 'expired', lostUnits: 1, lossCost: 15, lossValue: 20 },
    ])
    // 2 × (20 − 15) and nothing taken off for shrinkage — nor anything added for the find.
    assert.equal(summary.grossProfit, 10)
    assert.equal(summary.netProfit, 10)

    const breakdown = await service.getProductBreakdown(supplier.id, now.year, 1, 20, {})
    const [row] = breakdown.data
    assert.equal(row.lostUnits, -2)
    assert.equal(row.lossCost, 0)
  })

  test('net profit leaves out shrinkage it has no profit for (BE-07)', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const bar = await ProductFactory.merge({ categoryId: category.id }).create()
    const cola = await ProductFactory.merge({ categoryId: category.id }).create()
    const now = DateTime.now().setZone(FRIDGE_TIMEZONE)
    const barLot = await Delivery.create({
      supplierId: supplier.id,
      productId: bar.id,
      amountSupplied: 12,
      amountLeft: 2,
      amountLost: 0,
      price: 20,
      purchasePrice: null,
    })
    await sell(barLot.id, buyer.id, 10, 20, now)
    await new InventoryService().writeOff(supplier, {
      productId: bar.id,
      quantity: 1,
      reason: 'stolen',
    })

    // No purchase price anywhere: the profit is unknown, not "−20 Kč".
    const unknown = await service.getSummary(supplier.id, now.year, 0)
    assert.isNull(unknown.netProfit)
    assert.equal(unknown.shrinkage.lossCost, 20)

    // With one lot priced, only its shrinkage comes off its profit.
    const colaLot = await Delivery.create({
      supplierId: supplier.id,
      productId: cola.id,
      amountSupplied: 10,
      amountLeft: 6,
      amountLost: 0,
      price: 16,
      purchasePrice: 12,
    })
    await sell(colaLot.id, buyer.id, 3, 16, now)
    await new InventoryService().writeOff(supplier, {
      productId: cola.id,
      quantity: 1,
      reason: 'damaged',
    })
    const mixed = await service.getSummary(supplier.id, now.year, 0)
    assert.equal(mixed.grossProfit, 12)
    assert.equal(mixed.netProfit, 0)
    // The shrinkage KPI still values every lost piece.
    assert.equal(mixed.shrinkage.lossCost, 32)

    const breakdown = await service.getProductBreakdown(supplier.id, now.year, 1, 20, {
      sortBy: 'productName',
      sortOrder: 'asc',
    })
    const colaRow = breakdown.data.find((row) => row.productId === cola.id)!
    assert.equal(colaRow.revenueWithCost, 48)
    const barRow = breakdown.data.find((row) => row.productId === bar.id)!
    assert.equal(barRow.revenueWithCost, 0)
    assert.equal(barRow.unitsWithCost, 0)
  })

  test('the limit counts money received by the payment date; the rest is pending (F4)', async ({
    assert,
  }) => {
    env.set('SUPPLIER_INCOME_LIMIT', 1000)
    const supplier = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const cola = await ProductFactory.merge({ categoryId: category.id }).create()
    const now = DateTime.now().setZone(FRIDGE_TIMEZONE)
    const lot = await Delivery.create({
      supplierId: supplier.id,
      productId: cola.id,
      amountSupplied: 40,
      amountLeft: 20,
      amountLost: 0,
      price: 20,
      purchasePrice: null,
    })
    // Bought in December last year, paid in January this year — this year's income.
    const lastDecember = now.minus({ years: 1 }).set({ month: 12, day: 20 })
    await sell(lot.id, buyer.id, 5, 20, lastDecember)
    const paidInJanuary = await Invoice.create({
      buyerId: buyer.id,
      supplierId: supplier.id,
      totalCost: 100,
      isPaid: true,
      isPaymentRequested: false,
      paidAt: now.set({ month: 1, day: 5 }),
    })
    await db.from('orders').whereNull('invoice_id').update({ invoice_id: paidInJanuary.id })
    // Own consumption: a self-invoice is paid at once but is no income.
    await Invoice.create({
      buyerId: supplier.id,
      supplierId: supplier.id,
      totalCost: 60,
      isPaid: true,
      isPaymentRequested: false,
      paidAt: now,
    })
    // Waiting: an unpaid invoice and purchases not invoiced yet.
    await Invoice.create({
      buyerId: buyer.id,
      supplierId: supplier.id,
      totalCost: 40,
      isPaid: false,
      isPaymentRequested: true,
      paidAt: null,
    })
    await sell(lot.id, buyer.id, 3, 20, now)
    await sell(lot.id, supplier.id, 2, 20, now)
    // A colleague's paid invoice is theirs.
    await Invoice.create({
      buyerId: buyer.id,
      supplierId: colleague.id,
      totalCost: 500,
      isPaid: true,
      isPaymentRequested: false,
      paidAt: now,
    })

    assert.equal(await service.receivedIn(supplier.id, now.year), 100)
    assert.equal(await service.receivedIn(supplier.id, now.year - 1), 0)
    const banner = await service.currentLimitStatus(supplier.id)
    assert.deepInclude(banner!, { amount: 100, pending: 100, percent: 10, level: 'ok' })
    const summary = await service.getSummary(supplier.id, now.year, 0)
    assert.deepInclude(summary.incomeLimit, { amount: 100, pending: 100 })
    // Sales stay by the purchase date — the 5 December pieces are last year's.
    assert.equal(summary.revenue, 60)
    const lastYear = await service.getSummary(supplier.id, now.year - 1, 0)
    assert.deepInclude(lastYear.incomeLimit, { amount: 0, pending: null })

    // A rejected payment takes the money back out.
    paidInJanuary.merge({ isPaid: false, paidAt: null })
    await paidInJanuary.save()
    assert.equal(await service.receivedIn(supplier.id, now.year), 0)
  })

  test('the money row: purchased this year, stock at cost, owed (F5)', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const cola = await ProductFactory.merge({ categoryId: category.id }).create()
    const now = DateTime.now().setZone(FRIDGE_TIMEZONE)
    const priced = await Delivery.create({
      supplierId: supplier.id,
      productId: cola.id,
      amountSupplied: 10,
      amountLeft: 4,
      amountLost: 0,
      price: 20,
      purchasePrice: 12.5,
    })
    await Delivery.create({
      supplierId: supplier.id,
      productId: cola.id,
      amountSupplied: 6,
      amountLeft: 6,
      amountLost: 0,
      price: 20,
      purchasePrice: null,
    })
    // Voided and last year's lots are not this year's purchases.
    await Delivery.create({
      supplierId: supplier.id,
      productId: cola.id,
      amountSupplied: 5,
      amountLeft: 5,
      amountLost: 0,
      price: 20,
      purchasePrice: 10,
      voidedAt: now,
    })
    await Delivery.create({
      supplierId: supplier.id,
      productId: cola.id,
      amountSupplied: 2,
      amountLeft: 1,
      amountLost: 0,
      price: 20,
      purchasePrice: 8,
      createdAt: now.minus({ years: 1 }),
    })
    await sell(priced.id, buyer.id, 6, 20, now)
    await Invoice.create({
      buyerId: buyer.id,
      supplierId: supplier.id,
      totalCost: 35,
      isPaid: false,
      isPaymentRequested: false,
      paidAt: null,
    })

    const { money } = await service.getSummary(supplier.id, now.year, 0)
    assert.deepEqual(money, {
      purchased: 125,
      stockAtCost: 58,
      stockUnitsWithoutCost: 6,
      uninvoiced: 120,
      unpaid: 35,
    })
  })

  test('the yearly limit is measured on revenue, warns ahead and flags an excess', async ({
    assert,
  }) => {
    env.set('SUPPLIER_INCOME_LIMIT', 1000)
    assert.deepInclude(service.limitStatus(500), {
      enabled: true,
      limit: 1000,
      warnPercent: 80,
      amount: 500,
      level: 'ok',
      percent: 50,
    })
    assert.deepInclude(service.limitStatus(850), { level: 'warn', percent: 85 })
    assert.deepInclude(service.limitStatus(1200), { level: 'exceeded', percent: 120 })
    // The level comes from the exact amount; the shown percentage never rounds up to it.
    env.set('SUPPLIER_INCOME_LIMIT', 10_000)
    assert.deepInclude(service.limitStatus(9995), { level: 'warn', percent: 99.9 })
    assert.deepInclude(service.limitStatus(10_000), { level: 'exceeded', percent: 100 })
    assert.deepInclude(service.limitStatus(7995), { level: 'ok', percent: 79.9 })
    assert.deepInclude(service.limitStatus(8000), { level: 'warn', percent: 80 })
    env.set('SUPPLIER_INCOME_LIMIT', 1000)

    env.set('SUPPLIER_INCOME_LIMIT', 0)
    assert.deepInclude(service.limitStatus(5000), { enabled: false, level: 'ok' })
  })

  test('years run from the first lot up to this one', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const current = service.currentYear()
    await Delivery.create({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 1,
      amountLeft: 1,
      amountLost: 0,
      price: 10,
      createdAt: DateTime.now().minus({ years: 2 }),
    })
    assert.deepEqual(await service.yearOptions(supplier.id), [current, current - 1, current - 2])
  })
})
