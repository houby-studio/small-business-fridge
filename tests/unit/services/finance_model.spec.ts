import '#tests/test_context'
import { test } from '@japa/runner'
import fc from 'fast-check'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import FinanceService, { type ProductBreakdownRow } from '#services/finance_service'

/**
 * U-F4 — the finance report against a reference model. Random lots of two suppliers (with and
 * without a purchase price), sales to a customer, to the colleague and to the supplier
 * themself at whatever price the order carries (a corrected one too), losses and inventory
 * surpluses (some reverted), all spread over both sides of New Year's midnight in Prague.
 * The model below is written from the rules in docs/shopping-list.md, in whole hellers so no
 * floating point hides an error:
 *
 * - a sale is an order on my lot by someone else; my own purchase is own consumption;
 * - revenue and profit use what the order costs, cost of sales the lot's purchase price;
 *   profit is only told where the purchase price is known;
 * - shrinkage = losses minus surpluses of my lots, never below zero; reverted rows are gone;
 *   net profit takes off only the shrinkage of lots with a purchase price;
 * - the breakdown lists every product with a sale or a loss/surplus and adds up to the summary.
 *
 * Catches: a filter lost in one of the two SQL paths (summary vs breakdown), a reverted row
 * still counted, the year cut in UTC, own consumption counted as a sale, the wrong price
 * column, OFFSET/LIMIT paging that drops or repeats a product.
 */

const finance = new FinanceService()

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

const REASONS = ['damaged', 'expired', 'stolen', 'other', 'inventory'] as const
type When = 'mid' | 'lastYearMid' | 'lastHour' | 'firstHour'

interface LotSpec {
  mine: boolean
  product: number
  price: number
  /** In hellers; null = unknown. */
  cost: number | null
}
interface OrderSpec {
  lot: number
  buyer: 'customer' | 'me' | 'colleague'
  price: number
  when: When
}
interface AdjustmentSpec {
  lot: number
  kind: 'loss' | 'surplus'
  reason: (typeof REASONS)[number]
  quantity: number
  when: When
  reverted: boolean
}
interface Scenario {
  lots: LotSpec[]
  orders: OrderSpec[]
  adjustments: AdjustmentSpec[]
}

const whenArb = fc.constantFrom<When>('mid', 'lastYearMid', 'lastHour', 'firstHour')
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .array(
    fc.record({
      mine: fc.boolean(),
      product: fc.nat({ max: 3 }),
      price: fc.integer({ min: 5, max: 60 }),
      cost: fc.option(fc.integer({ min: 1, max: 5000 }), { nil: null, freq: 3 }),
    }),
    { minLength: 1, maxLength: 6 }
  )
  .chain((lots) =>
    fc.record({
      lots: fc.constant(lots),
      orders: fc.array(
        fc.record({
          lot: fc.nat({ max: lots.length - 1 }),
          buyer: fc.constantFrom<OrderSpec['buyer']>('customer', 'me', 'colleague'),
          price: fc.integer({ min: 1, max: 60 }),
          when: whenArb,
        }),
        { maxLength: 25 }
      ),
      adjustments: fc.array(
        fc.record({
          lot: fc.nat({ max: lots.length - 1 }),
          kind: fc.constantFrom<AdjustmentSpec['kind']>('loss', 'loss', 'surplus'),
          reason: fc.constantFrom(...REASONS),
          quantity: fc.integer({ min: 1, max: 5 }),
          when: whenArb,
          reverted: fc.boolean(),
        }),
        { maxLength: 10 }
      ),
    })
  )

const round2 = (value: number) => Math.round(value * 100) / 100

/** The summary and breakdown of `year` for the supplier, from the rules alone. */
function model(scenario: Scenario, yearOf: (when: When) => number, year: number) {
  const sales = scenario.orders.filter(
    (o) => scenario.lots[o.lot].mine && yearOf(o.when) === year && o.buyer !== 'me'
  )
  const own = scenario.orders.filter(
    (o) => scenario.lots[o.lot].mine && yearOf(o.when) === year && o.buyer === 'me'
  )
  const adjustments = scenario.adjustments.filter(
    (a) => scenario.lots[a.lot].mine && yearOf(a.when) === year && !a.reverted
  )
  const withCost = sales.filter((o) => scenario.lots[o.lot].cost !== null)
  const costHellers = withCost.reduce((sum, o) => sum + scenario.lots[o.lot].cost!, 0)
  const revenueWithCost = withCost.reduce((sum, o) => sum + o.price, 0)
  // Value of an adjustment in hellers: at purchase price, at selling price where unknown.
  const atCost = (a: AdjustmentSpec) =>
    a.quantity * (scenario.lots[a.lot].cost ?? scenario.lots[a.lot].price * 100)
  const losses = adjustments.filter((a) => a.kind === 'loss')
  const surpluses = adjustments.filter((a) => a.kind === 'surplus')
  const sumOf = (list: AdjustmentSpec[], value: (a: AdjustmentSpec) => number) =>
    list.reduce((sum, a) => sum + value(a), 0)
  const lostUnits = sumOf(losses, (a) => a.quantity)
  const surplusUnits = sumOf(surpluses, (a) => a.quantity)
  const known = (a: AdjustmentSpec) =>
    scenario.lots[a.lot].cost === null ? 0 : a.quantity * scenario.lots[a.lot].cost!
  const netLost = Math.max(0, lostUnits - surplusUnits)
  const leftShelf = sales.length + own.length + netLost
  const grossProfit = round2((revenueWithCost * 100 - costHellers) / 100)

  const byReason = REASONS.map((reason) => {
    const rows = losses.filter((a) => a.reason === reason)
    return {
      reason,
      lostUnits: sumOf(rows, (a) => a.quantity),
      lossCost: sumOf(rows, atCost) / 100,
      lossValue: sumOf(rows, (a) => a.quantity * scenario.lots[a.lot].price),
    }
  })
    .filter((row) => row.lostUnits > 0)
    .sort((a, b) => b.lossCost - a.lossCost || a.reason.localeCompare(b.reason))

  const summary = {
    unitsSold: sales.length,
    revenue: sales.reduce((sum, o) => sum + o.price, 0),
    unitsWithCost: withCost.length,
    revenueWithCost,
    costOfSales: costHellers / 100,
    grossProfit,
    unitsWithoutCost: sales.length - withCost.length,
    ownConsumption: { units: own.length, value: own.reduce((sum, o) => sum + o.price, 0) },
    lostUnits,
    surplusUnits,
    surplusCost: sumOf(surpluses, atCost) / 100,
    lossCost: Math.max(0, sumOf(losses, atCost) - sumOf(surpluses, atCost)) / 100,
    lossValue: Math.max(
      0,
      sumOf(losses, (a) => a.quantity * scenario.lots[a.lot].price) -
        sumOf(surpluses, (a) => a.quantity * scenario.lots[a.lot].price)
    ),
    lossRate: leftShelf > 0 ? Math.round((netLost / leftShelf) * 10_000) / 10_000 : 0,
    byReason,
    netProfit:
      withCost.length > 0
        ? round2(grossProfit - Math.max(0, sumOf(losses, known) - sumOf(surpluses, known)) / 100)
        : null,
  }

  const products = new Map<number, ReturnType<typeof emptyRow>>()
  function emptyRow() {
    return {
      sold: 0,
      revenue: 0,
      withCost: 0,
      revenueWithCost: 0,
      cost: 0,
      own: 0,
      lost: 0,
      lossCost: 0,
      touched: false,
    }
  }
  const rowOf = (lot: number) => {
    const product = scenario.lots[lot].product
    if (!products.has(product)) products.set(product, emptyRow())
    return products.get(product)!
  }
  for (const o of sales) {
    const row = rowOf(o.lot)
    row.sold++
    row.revenue += o.price
    if (scenario.lots[o.lot].cost !== null) {
      row.withCost++
      row.revenueWithCost += o.price
      row.cost += scenario.lots[o.lot].cost!
    }
  }
  for (const o of own) rowOf(o.lot).own++
  for (const a of adjustments) {
    const row = rowOf(a.lot)
    const sign = a.kind === 'loss' ? 1 : -1
    row.lost += sign * a.quantity
    row.lossCost += sign * atCost(a)
    row.touched = true
  }
  const breakdown = [...products]
    .filter(([, row]) => row.sold > 0 || row.touched)
    .map(([product, row]) => {
      const lost = Math.max(0, row.lost)
      const shelf = row.sold + row.own + lost
      return [
        product,
        row.sold,
        row.revenue,
        row.withCost,
        row.revenueWithCost,
        row.cost / 100,
        row.withCost > 0 ? round2((row.revenueWithCost * 100 - row.cost) / 100) : null,
        row.lost,
        Math.max(0, row.lossCost) / 100,
        shelf > 0 ? Math.round((lost / shelf) * 1000) / 1000 : 0,
      ]
    })
    .sort((a, b) => Number(a[0]) - Number(b[0]))
  return { summary, breakdown }
}

test.group('FinanceService — reference model (U-F4)', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('summary and breakdown match the rules for any mix of lots, sales and shrinkage', async ({
    assert,
  }) => {
    const current = finance.currentYear()
    // Winter in Prague is UTC+1: 22:30Z on 31 Dec is still the old year, 23:30Z the new one.
    const instants: Record<When, Date> = {
      mid: new Date(Date.UTC(current, 5, 15, 12)),
      lastYearMid: new Date(Date.UTC(current - 1, 5, 15, 12)),
      lastHour: new Date(Date.UTC(current - 1, 11, 31, 22, 30)),
      firstHour: new Date(Date.UTC(current - 1, 11, 31, 23, 30)),
    }
    const yearOf = (when: When) => (when === 'mid' || when === 'firstHour' ? current : current - 1)
    let compared = 0

    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        await cleanAll()
        const [meUser, colleagueUser, customerUser] = [
          await UserFactory.apply('supplier').create(),
          await UserFactory.apply('supplier').create(),
          await UserFactory.create(),
        ]
        const [me, colleague, customer] = [meUser.id, colleagueUser.id, customerUser.id]
        const category = await CategoryFactory.create()
        const productIds: number[] = []
        for (const displayName of ['Alfa', 'Beta', 'Gama', 'Delta']) {
          const created = await ProductFactory.merge({
            categoryId: category.id,
            displayName,
          }).create()
          productIds.push(created.id)
        }
        const lotIds: number[] = []
        for (const lot of scenario.lots) {
          const [row] = await db
            .table('deliveries')
            .insert({
              supplier_id: lot.mine ? me : colleague,
              product_id: productIds[lot.product],
              amount_supplied: 100,
              amount_left: 100,
              amount_lost: 0,
              price: lot.price,
              purchase_price: lot.cost === null ? null : lot.cost / 100,
              created_at: instants.lastYearMid,
              updated_at: instants.lastYearMid,
            })
            .returning('id')
          lotIds.push(row.id)
        }
        const buyerId = { customer, me, colleague }
        if (scenario.orders.length > 0) {
          await db.table('orders').multiInsert(
            scenario.orders.map((o) => ({
              buyer_id: buyerId[o.buyer],
              delivery_id: lotIds[o.lot],
              channel: 'kiosk',
              unit_price: o.price,
              created_at: instants[o.when],
              updated_at: instants[o.when],
            }))
          )
        }
        if (scenario.adjustments.length > 0) {
          await db.table('stock_adjustments').multiInsert(
            scenario.adjustments.map((a) => {
              const lot = scenario.lots[a.lot]
              return {
                delivery_id: lotIds[a.lot],
                product_id: productIds[lot.product],
                supplier_id: lot.mine ? me : colleague,
                actor_id: me,
                kind: a.kind,
                reason: a.kind === 'surplus' ? 'inventory' : a.reason,
                quantity: a.quantity,
                unit_cost: lot.cost === null ? null : lot.cost / 100,
                unit_price: lot.price,
                created_at: instants[a.when],
                reverted_at: a.reverted ? instants[a.when] : null,
              }
            })
          )
        }
        // A surplus is always an inventory finding.
        const normalised: Scenario = {
          ...scenario,
          adjustments: scenario.adjustments.map((a) =>
            a.kind === 'surplus' ? { ...a, reason: 'inventory' } : a
          ),
        }

        for (const year of [current, current - 1]) {
          const expected = model(normalised, yearOf, year)
          const summary = await finance.getSummary(me, year, 0)
          const actualSummary = {
            unitsSold: summary.unitsSold,
            revenue: summary.revenue,
            unitsWithCost: summary.unitsWithCost,
            revenueWithCost: summary.revenueWithCost,
            costOfSales: summary.costOfSales,
            grossProfit: summary.grossProfit,
            unitsWithoutCost: summary.unitsWithoutCost,
            ownConsumption: summary.ownConsumption,
            lostUnits: summary.shrinkage.lostUnits,
            surplusUnits: summary.shrinkage.surplusUnits,
            surplusCost: summary.shrinkage.surplusCost,
            lossCost: summary.shrinkage.lossCost,
            lossValue: summary.shrinkage.lossValue,
            lossRate: summary.shrinkage.lossRate,
            byReason: summary.shrinkage.byReason,
            netProfit: summary.netProfit,
          }
          assert.deepEqual(actualSummary, expected.summary, `summary of ${year}`)

          // Every page of two, together: each product once, as the model says.
          const rows: ProductBreakdownRow[] = []
          for (let page = 1; ; page++) {
            const result = await finance.getProductBreakdown(me, year, page, 2, {})
            rows.push(...result.data)
            assert.equal(result.meta.total, expected.breakdown.length)
            if (page >= result.meta.lastPage) break
          }
          const actualBreakdown = rows
            .map((row) => [
              productIds.indexOf(row.productId),
              row.unitsSold,
              row.revenue,
              row.unitsWithCost,
              row.revenueWithCost,
              row.costOfSales,
              row.grossProfit,
              row.lostUnits,
              row.lossCost,
              row.lossRate,
            ])
            .sort((a, b) => Number(a[0]) - Number(b[0]))
          assert.deepEqual(actualBreakdown, expected.breakdown, `breakdown of ${year}`)

          // And the breakdown adds up to the summary.
          const total = (pick: (row: ProductBreakdownRow) => number) =>
            rows.reduce((sum, row) => sum + pick(row), 0)
          assert.equal(
            total((r) => r.unitsSold),
            summary.unitsSold
          )
          assert.equal(
            total((r) => r.revenue),
            summary.revenue
          )
          assert.equal(round2(total((r) => r.costOfSales)), summary.costOfSales)
          assert.equal(
            total((r) => r.lostUnits),
            summary.shrinkage.lostUnits - summary.shrinkage.surplusUnits
          )
          compared++
        }
      }),
      {
        seed: 20261004,
        numRuns: 80,
        endOnFailure: true,
        // Always tried first: a priced sale next to a loss of a lot without a purchase price,
        // the case where net profit must leave the loss out (BE-07) — rare in random data.
        examples: [
          [
            {
              lots: [
                { mine: true, product: 0, price: 20, cost: 1000 },
                { mine: true, product: 1, price: 30, cost: null },
              ],
              orders: [{ lot: 0, buyer: 'customer', price: 20, when: 'mid' }],
              adjustments: [
                {
                  lot: 1,
                  kind: 'loss',
                  reason: 'stolen',
                  quantity: 2,
                  when: 'mid',
                  reverted: false,
                },
              ],
            },
          ],
        ],
      }
    )
    assert.equal(compared, 160)
  }).timeout(120_000)
})
