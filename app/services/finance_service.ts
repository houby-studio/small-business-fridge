import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { FRIDGE_TIMEZONE } from '#config/fridge'
import { breakEvenMarginPercent, roundMoney } from '#services/shopping/pricing'
import type { StockAdjustmentReason } from '#models/stock_adjustment'

/** How close this year's sales to other people are to the configured yearly limit. */
export interface IncomeLimitStatus {
  enabled: boolean
  limit: number
  warnPercent: number
  /** This year's revenue from other people — the legal notion of income. */
  amount: number
  percent: number
  level: 'ok' | 'warn' | 'exceeded'
}

export interface ShrinkageByReason {
  reason: StockAdjustmentReason
  lostUnits: number
  /** Lost pieces valued at purchase price (selling price where unknown). */
  lossCost: number
  /** Lost pieces valued at selling price. */
  lossValue: number
}

export interface FinanceSummary {
  year: number
  /** What other people bought from the supplier's lots — the supplier's own purchases are not sales. */
  unitsSold: number
  revenue: number
  /** The part of the sales whose purchase price is known — profit can only be told there. */
  unitsWithCost: number
  revenueWithCost: number
  costOfSales: number
  grossProfit: number
  /** Gross profit over cost of sales, in percent (the margin actually achieved). */
  achievedMarginPercent: number | null
  unitsWithoutCost: number
  /**
   * What the supplier bought from their own lots: own consumption, not income. Left out of
   * the sales, the profit and the yearly limit; `value` is what they paid themselves.
   */
  ownConsumption: { units: number; value: number }
  shrinkage: {
    lostUnits: number
    surplusUnits: number
    /** Pieces an inventory found, valued at purchase price (selling price where unknown). */
    surplusCost: number
    /**
     * Net lost pieces valued at purchase price (selling price where unknown): the reasons'
     * `lossCost` added up minus `surplusCost`, never below zero.
     */
    lossCost: number
    /** Net lost pieces valued at selling price — what the supplier was not paid; never below zero. */
    lossValue: number
    /** Net lost pieces out of everything that left the shelf (sold + own consumption + lost), 0–1. */
    lossRate: number
    /** Lost pieces per reason (surplus not netted in), the costliest first. */
    byReason: ShrinkageByReason[]
  }
  netProfit: number
  /** The markup that just covers the shrinkage rate. */
  breakEvenMarginPercent: number
  marginPercent: number
  incomeLimit: IncomeLimitStatus
}

/** A sale to someone else — buying from your own lot is own consumption, not income. */
const SOLD_TO_OTHERS = 'orders.buyer_id <> deliveries.supplier_id'
const OWN_CONSUMPTION = 'orders.buyer_id = deliveries.supplier_id'

const SORT_COLUMNS: Record<string, string> = {
  productName: 'product_name',
  unitsSold: 'units_sold',
  revenue: 'revenue',
  grossProfit: 'gross_profit',
  lostUnits: 'lost_units',
}

/**
 * What a supplier earns: sales from their lots to other people against what they paid,
 * minus shrinkage. Buying from your own lot is own consumption — reported, never income.
 * Years are calendar years in the fridge's timezone, like the tax year.
 */
export default class FinanceService {
  static incomeLimitConfig() {
    const limit = Number(env.get('SUPPLIER_INCOME_LIMIT') ?? 0)
    return {
      limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
      warnPercent: Number(env.get('SUPPLIER_INCOME_LIMIT_WARN_PERCENT') ?? 80),
    }
  }

  yearRange(year: number) {
    const start = DateTime.fromObject({ year, month: 1, day: 1 }, { zone: FRIDGE_TIMEZONE })
    return { start: start.toJSDate(), end: start.plus({ years: 1 }).toJSDate() }
  }

  currentYear(): number {
    return DateTime.now().setZone(FRIDGE_TIMEZONE).year
  }

  /** Years the supplier has sales or stock in, newest first; always includes this year. */
  async yearOptions(supplierId: number): Promise<number[]> {
    const row = await db
      .from('deliveries')
      .where('supplier_id', supplierId)
      .select(db.raw('MIN(created_at) AS first'))
      .first()
    const current = this.currentYear()
    const first = row?.first
      ? DateTime.fromJSDate(new Date(row.first)).setZone(FRIDGE_TIMEZONE).year
      : current
    const years: number[] = []
    for (let year = current; year >= Math.min(first, current); year--) years.push(year)
    return years
  }

  async getSummary(
    supplierId: number,
    year: number,
    marginPercent: number
  ): Promise<FinanceSummary> {
    const { start, end } = this.yearRange(year)

    const [sales, adjustments] = await Promise.all([
      db
        .from('orders')
        .join('deliveries', 'deliveries.id', 'orders.delivery_id')
        .where('deliveries.supplier_id', supplierId)
        .where('orders.created_at', '>=', start)
        .where('orders.created_at', '<', end)
        .select(
          db.raw(`COUNT(*) FILTER (WHERE ${SOLD_TO_OTHERS})::int AS units`),
          db.raw(
            `COALESCE(SUM(orders.unit_price) FILTER (WHERE ${SOLD_TO_OTHERS}), 0)::int AS revenue`
          ),
          db.raw(
            `COUNT(*) FILTER (WHERE ${SOLD_TO_OTHERS} AND deliveries.purchase_price IS NOT NULL)::int AS units_with_cost`
          ),
          db.raw(
            `COALESCE(SUM(orders.unit_price) FILTER (WHERE ${SOLD_TO_OTHERS} AND deliveries.purchase_price IS NOT NULL), 0)::int AS revenue_with_cost`
          ),
          db.raw(
            `COALESCE(SUM(deliveries.purchase_price) FILTER (WHERE ${SOLD_TO_OTHERS}), 0)::numeric AS cost`
          ),
          db.raw(`COUNT(*) FILTER (WHERE ${OWN_CONSUMPTION})::int AS own_units`),
          db.raw(
            `COALESCE(SUM(orders.unit_price) FILTER (WHERE ${OWN_CONSUMPTION}), 0)::int AS own_value`
          )
        )
        .first(),
      db
        .from('stock_adjustments')
        .where('supplier_id', supplierId)
        .where('created_at', '>=', start)
        .where('created_at', '<', end)
        .groupBy('kind', 'reason')
        .select('kind', 'reason')
        .select(
          db.raw('SUM(quantity)::int AS quantity'),
          db.raw('SUM(quantity * COALESCE(unit_cost, unit_price))::numeric AS cost'),
          db.raw('SUM(quantity * unit_price)::int AS value')
        ),
    ])

    const unitsSold = Number(sales?.units ?? 0)
    const revenue = Number(sales?.revenue ?? 0)
    const unitsWithCost = Number(sales?.units_with_cost ?? 0)
    const revenueWithCost = Number(sales?.revenue_with_cost ?? 0)
    const costOfSales = roundMoney(Number(sales?.cost ?? 0))
    const grossProfit = roundMoney(revenueWithCost - costOfSales)
    const ownUnits = Number(sales?.own_units ?? 0)

    // Losses per reason; a surplus an inventory found offsets them in the totals — but
    // shrinkage never goes below zero, finding more than was lost is not income.
    let lostUnits = 0
    let surplusUnits = 0
    let grossLossCost = 0
    let surplusCost = 0
    let grossLossValue = 0
    let surplusValue = 0
    const byReason: ShrinkageByReason[] = []
    for (const row of adjustments) {
      const quantity = Number(row.quantity)
      const cost = Number(row.cost)
      const value = Number(row.value)
      if (row.kind === 'loss') {
        lostUnits += quantity
        grossLossCost += cost
        grossLossValue += value
        byReason.push({
          reason: row.reason as StockAdjustmentReason,
          lostUnits: quantity,
          lossCost: roundMoney(cost),
          lossValue: value,
        })
      } else {
        surplusUnits += quantity
        surplusCost += cost
        surplusValue += value
      }
    }
    byReason.sort((a, b) => b.lossCost - a.lossCost || a.reason.localeCompare(b.reason))

    const netLost = Math.max(0, lostUnits - surplusUnits)
    const lossCost = Math.max(0, roundMoney(grossLossCost - surplusCost))
    const lossValue = Math.max(0, grossLossValue - surplusValue)
    // Everything that left the shelf: sold to others, eaten by the supplier, or lost.
    const leftShelf = unitsSold + ownUnits + netLost
    const lossRate = leftShelf > 0 ? netLost / leftShelf : 0
    const netProfit = roundMoney(grossProfit - lossCost)

    return {
      year,
      unitsSold,
      revenue,
      unitsWithCost,
      revenueWithCost,
      costOfSales,
      grossProfit,
      achievedMarginPercent:
        costOfSales > 0 ? Math.round((grossProfit / costOfSales) * 10_000) / 100 : null,
      unitsWithoutCost: unitsSold - unitsWithCost,
      ownConsumption: { units: ownUnits, value: Number(sales?.own_value ?? 0) },
      shrinkage: {
        lostUnits,
        surplusUnits,
        surplusCost: roundMoney(surplusCost),
        lossCost,
        lossValue,
        lossRate: Math.round(lossRate * 10_000) / 10_000,
        byReason,
      },
      netProfit,
      breakEvenMarginPercent: breakEvenMarginPercent(lossRate),
      marginPercent,
      incomeLimit: this.limitStatus(revenue),
    }
  }

  /** Where the year's sales to other people stand against the configured limit. */
  limitStatus(revenue: number): IncomeLimitStatus {
    const config = FinanceService.incomeLimitConfig()
    const amount = revenue
    const percent = config.limit > 0 ? Math.round((amount / config.limit) * 1000) / 10 : 0
    return {
      enabled: config.limit > 0,
      limit: config.limit,
      warnPercent: config.warnPercent,
      amount: roundMoney(amount),
      percent,
      level:
        config.limit <= 0
          ? 'ok'
          : percent >= 100
            ? 'exceeded'
            : percent >= config.warnPercent
              ? 'warn'
              : 'ok',
    }
  }

  /** This year's limit status — cheap enough for the stock page banner. */
  async currentLimitStatus(supplierId: number, marginPercent: number) {
    if (!FinanceService.incomeLimitConfig().limit) return null
    const summary = await this.getSummary(supplierId, this.currentYear(), marginPercent)
    return summary.incomeLimit
  }

  /** Per-product breakdown of a year, server-side paginated and sorted. */
  async getProductBreakdown(
    supplierId: number,
    year: number,
    page: number,
    perPage: number,
    sort: { sortBy?: string; sortOrder?: string }
  ) {
    const { start, end } = this.yearRange(year)
    const sortColumn = SORT_COLUMNS[sort.sortBy ?? ''] ?? 'revenue'
    const sortDirection = sort.sortOrder === 'asc' ? 'ASC' : 'DESC'

    // Own consumption is no sale, but it did leave the shelf — it counts in the loss rate.
    const salesSql = `
      SELECT deliveries.product_id,
             COUNT(*) FILTER (WHERE ${SOLD_TO_OTHERS})::int AS units_sold,
             COALESCE(SUM(orders.unit_price) FILTER (WHERE ${SOLD_TO_OTHERS}), 0)::int AS revenue,
             COUNT(*) FILTER (WHERE ${SOLD_TO_OTHERS} AND deliveries.purchase_price IS NOT NULL)::int AS units_with_cost,
             COALESCE(SUM(orders.unit_price) FILTER (WHERE ${SOLD_TO_OTHERS} AND deliveries.purchase_price IS NOT NULL), 0)::int AS revenue_with_cost,
             COALESCE(SUM(deliveries.purchase_price) FILTER (WHERE ${SOLD_TO_OTHERS}), 0)::numeric AS cost,
             COUNT(*) FILTER (WHERE ${OWN_CONSUMPTION})::int AS own_units
        FROM orders
        JOIN deliveries ON deliveries.id = orders.delivery_id
       WHERE deliveries.supplier_id = ? AND orders.created_at >= ? AND orders.created_at < ?
       GROUP BY deliveries.product_id`
    const lossSql = `
      SELECT product_id,
             SUM(CASE WHEN kind = 'loss' THEN quantity ELSE -quantity END)::int AS lost_units,
             SUM(CASE WHEN kind = 'loss' THEN 1 ELSE -1 END * quantity * COALESCE(unit_cost, unit_price))::numeric AS loss_cost
        FROM stock_adjustments
       WHERE supplier_id = ? AND created_at >= ? AND created_at < ?
       GROUP BY product_id`
    const bindings = [supplierId, start, end, supplierId, start, end]

    const baseSql = `
      WITH sales AS (${salesSql}), losses AS (${lossSql})
      SELECT p.id AS product_id,
             p.display_name AS product_name,
             COALESCE(s.units_sold, 0) AS units_sold,
             COALESCE(s.revenue, 0) AS revenue,
             COALESCE(s.units_with_cost, 0) AS units_with_cost,
             COALESCE(s.cost, 0) AS cost,
             (COALESCE(s.revenue_with_cost, 0) - COALESCE(s.cost, 0))::numeric AS gross_profit,
             COALESCE(s.own_units, 0) AS own_units,
             COALESCE(l.lost_units, 0) AS lost_units,
             COALESCE(l.loss_cost, 0) AS loss_cost
        FROM products p
        LEFT JOIN sales s ON s.product_id = p.id
        LEFT JOIN losses l ON l.product_id = p.id
       WHERE COALESCE(s.units_sold, 0) > 0 OR l.product_id IS NOT NULL`

    const [rows, total] = await Promise.all([
      db.rawQuery(
        `${baseSql} ORDER BY ${sortColumn} ${sortDirection}, product_name ASC LIMIT ? OFFSET ?`,
        [...bindings, perPage, (page - 1) * perPage]
      ),
      db.rawQuery(`SELECT COUNT(*)::int AS total FROM (${baseSql}) AS t`, bindings),
    ])

    const totalCount = Number(total.rows[0]?.total ?? 0)
    return {
      data: rows.rows.map((row: Record<string, unknown>) => {
        const unitsSold = Number(row.units_sold)
        const lostUnits = Number(row.lost_units)
        const netLost = Math.max(0, lostUnits)
        const leftShelf = unitsSold + Number(row.own_units) + netLost
        return {
          productId: Number(row.product_id),
          productName: String(row.product_name),
          unitsSold,
          revenue: Number(row.revenue),
          unitsWithCost: Number(row.units_with_cost),
          costOfSales: roundMoney(Number(row.cost)),
          grossProfit:
            Number(row.units_with_cost) > 0 ? roundMoney(Number(row.gross_profit)) : null,
          lostUnits,
          lossCost: Math.max(0, roundMoney(Number(row.loss_cost))),
          lossRate: leftShelf > 0 ? Math.round((netLost / leftShelf) * 1000) / 1000 : 0,
        }
      }),
      meta: {
        total: totalCount,
        perPage,
        currentPage: page,
        lastPage: Math.max(1, Math.ceil(totalCount / perPage)),
      },
    }
  }
}
