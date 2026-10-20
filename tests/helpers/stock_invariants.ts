import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Assert } from '@japa/assert'
import DeliveryService from '#services/delivery_service'

/**
 * Bookkeeping rules every lot must keep whatever happened to it — sales, storno, write-offs
 * and their revert, inventories, corrections, voids, repricing and a handover of stock.
 * Call `assertStockInvariants` at the end of every test that changes lots; a property test
 * can call `collectStockViolations` after each step instead.
 *
 * - I1  amount_supplied = amount_left + orders + amount_lost, amount_left >= 0.
 * - I2  amount_lost = Σ loss − Σ surplus of the lot's adjustments that are not reverted.
 *       A handover (`transfer` correction) moves found pieces (a negative balance) with the
 *       stock to the new lot, so at that moment the balance of the original is cut to
 *       max(0, balance) — adjustments after the handover count normally again.
 * - I3  a voided lot: amount_supplied = amount_left = amount_lost = 0, no orders, no
 *       adjustment created after it was voided.
 * - I4  the stock overview adds up: totals.totalRemaining = Σ amount_left of live lots =
 *       Σ rows; per row totalSold = orders of its live lots (scope all and every supplier's
 *       own scope).
 * - I5  an order's price history is consistent: original_unit_price and price_correction_id
 *       are set together, and a corrected order costs what its correction set.
 * - I6  a reverted adjustment is a manual write-off (loss, no inventory) with reverted_by.
 * - I7  a handed-over lot keeps the FIFO position of its origin (same created_at, same
 *       product and prices) and belongs to someone else.
 */
export interface StockInvariantOptions {
  /** Only these products (default: every lot in the database). */
  productIds?: number[]
  /** Skip I4 — it runs the overview SQL per supplier, which a big property loop may not want. */
  skipOverview?: boolean
  client?: QueryClientContract
}

interface LotRow {
  id: number
  supplier_id: number
  product_id: number
  amount_supplied: number
  amount_left: number
  amount_lost: number
  price: number
  purchase_price: string | null
  voided_at: Date | null
  transferred_from_id: number | null
  created_at: Date
}

export async function collectStockViolations(
  options: StockInvariantOptions = {}
): Promise<string[]> {
  const client = options.client ?? db.connection()
  const violations: string[] = []
  const scoped = <T extends { whereIn: (...args: any[]) => T }>(query: T, column: string) =>
    options.productIds ? query.whereIn(column, options.productIds) : query

  const lots: LotRow[] = await scoped(
    client.from('deliveries').select('*').orderBy('id', 'asc'),
    'product_id'
  )
  if (lots.length === 0) return violations
  const lotIds = lots.map((l) => l.id)

  const orderCounts = new Map<number, number>()
  for (const row of await client
    .from('orders')
    .whereIn('delivery_id', lotIds)
    .groupBy('delivery_id')
    .select('delivery_id', db.raw('COUNT(*)::int AS n'))) {
    orderCounts.set(Number(row.delivery_id), Number(row.n))
  }

  const adjustments = await client
    .from('stock_adjustments')
    .whereIn('delivery_id', lotIds)
    .select('*')
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
  const transfers = await client
    .from('delivery_corrections')
    .whereIn('delivery_id', lotIds)
    .where('kind', 'transfer')
    .select('delivery_id', 'created_at', 'id')

  for (const lot of lots) {
    const where = `lot #${lot.id} (product ${lot.product_id}, supplier ${lot.supplier_id})`
    const orders = orderCounts.get(lot.id) ?? 0

    // I1
    if (lot.amount_left < 0) violations.push(`I1 ${where}: amount_left ${lot.amount_left} < 0`)
    if (lot.amount_supplied !== lot.amount_left + orders + lot.amount_lost) {
      violations.push(
        `I1 ${where}: supplied ${lot.amount_supplied} ≠ left ${lot.amount_left} + orders ${orders} + lost ${lot.amount_lost}`
      )
    }

    // I2 — replay the lot's adjustments and handovers in time order.
    const isHandoverOrigin = transfers.some(
      (t) => Number(t.delivery_id) === lot.id && lots.some((l) => l.transferred_from_id === lot.id)
    )
    const events = [
      ...adjustments
        .filter((a) => Number(a.delivery_id) === lot.id && a.reverted_at === null)
        .map((a) => ({
          at: new Date(a.created_at).getTime(),
          seq: Number(a.id) * 2,
          delta: a.kind === 'loss' ? Number(a.quantity) : -Number(a.quantity),
        })),
      ...(isHandoverOrigin
        ? transfers
            .filter((t) => Number(t.delivery_id) === lot.id)
            .map((t) => ({ at: new Date(t.created_at).getTime(), seq: -1, delta: null }))
        : []),
    ].sort((a, b) => a.at - b.at || a.seq - b.seq)
    let balance = 0
    for (const event of events) {
      balance = event.delta === null ? Math.max(0, balance) : balance + event.delta
    }
    if (lot.amount_lost !== balance) {
      violations.push(`I2 ${where}: amount_lost ${lot.amount_lost} ≠ adjustments ${balance}`)
    }

    // I3
    if (lot.voided_at) {
      if (lot.amount_supplied !== 0 || lot.amount_left !== 0 || lot.amount_lost !== 0) {
        violations.push(
          `I3 ${where}: voided with supplied ${lot.amount_supplied}, left ${lot.amount_left}, lost ${lot.amount_lost}`
        )
      }
      if (orders > 0) violations.push(`I3 ${where}: voided lot has ${orders} orders`)
      const voidedAt = new Date(lot.voided_at).getTime()
      const late = adjustments.filter(
        (a) => Number(a.delivery_id) === lot.id && new Date(a.created_at).getTime() > voidedAt
      )
      if (late.length > 0) {
        violations.push(`I3 ${where}: ${late.length} adjustment(s) after it was voided`)
      }
    }

    // I7
    if (lot.transferred_from_id !== null) {
      const origin = lots.find((l) => l.id === lot.transferred_from_id)
      if (origin) {
        if (new Date(origin.created_at).getTime() !== new Date(lot.created_at).getTime()) {
          violations.push(`I7 ${where}: created_at differs from its origin #${origin.id}`)
        }
        if (origin.product_id !== lot.product_id || origin.supplier_id === lot.supplier_id) {
          violations.push(`I7 ${where}: product or owner does not fit origin #${origin.id}`)
        }
        if (
          origin.purchase_price !== lot.purchase_price ||
          (lot.price !== origin.price && !(await repricedSince(client, lot.id, origin.id)))
        ) {
          violations.push(`I7 ${where}: prices differ from origin #${origin.id}`)
        }
      }
    }
  }

  // I6
  for (const a of adjustments) {
    if (a.reverted_at === null) continue
    if (a.kind !== 'loss' || a.inventory_count_id !== null || a.reverted_by === null) {
      violations.push(
        `I6 adjustment #${a.id}: reverted but kind ${a.kind}, count ${a.inventory_count_id}`
      )
    }
  }

  // I5
  const orders = await client
    .from('orders')
    .leftJoin('delivery_corrections', 'delivery_corrections.id', 'orders.price_correction_id')
    .whereIn('orders.delivery_id', lotIds)
    .select(
      'orders.id',
      'orders.unit_price',
      'orders.original_unit_price',
      'orders.price_correction_id',
      'delivery_corrections.new_price as corrected_to',
      'delivery_corrections.delivery_id as corrected_lot',
      'orders.delivery_id'
    )
  for (const o of orders) {
    if ((o.original_unit_price === null) !== (o.price_correction_id === null)) {
      violations.push(`I5 order #${o.id}: original_unit_price and price_correction_id disagree`)
    }
    if (o.price_correction_id !== null) {
      if (Number(o.corrected_to) !== Number(o.unit_price)) {
        violations.push(
          `I5 order #${o.id}: unit_price ${o.unit_price} ≠ correction ${o.corrected_to}`
        )
      }
      if (Number(o.corrected_lot) !== Number(o.delivery_id)) {
        violations.push(`I5 order #${o.id}: repriced by a correction of another lot`)
      }
    }
  }

  // I4
  if (!options.skipOverview && !options.productIds) {
    const live = lots.filter((l) => !l.voided_at)
    const service = new DeliveryService()
    const suppliers = [...new Set(lots.map((l) => l.supplier_id))]
    const views: Array<{ label: string; supplierId: number; scope: 'all' | 'mine' }> = [
      { label: 'all', supplierId: suppliers[0], scope: 'all' },
      ...suppliers.map((id) => ({
        label: `mine of ${id}`,
        supplierId: id,
        scope: 'mine' as const,
      })),
    ]
    for (const view of views) {
      const inView = live.filter((l) => view.scope === 'all' || l.supplier_id === view.supplierId)
      const overview = await service.getStockForSupplier(view.supplierId, 1, 10_000, {
        scope: view.scope,
      })
      const expected = inView.reduce((s, l) => s + l.amount_left, 0)
      const rows = overview.data.reduce((s, r) => s + r.totalRemaining, 0)
      if (overview.totals.totalRemaining !== expected || rows !== expected) {
        violations.push(
          `I4 ${view.label}: totals ${overview.totals.totalRemaining}, rows ${rows}, lots ${expected}`
        )
      }
      for (const row of overview.data) {
        const sold = inView
          .filter((l) => l.product_id === row.productId)
          .reduce((s, l) => s + (orderCounts.get(l.id) ?? 0), 0)
        if (row.totalSold !== sold) {
          violations.push(
            `I4 ${view.label} product ${row.productId}: totalSold ${row.totalSold} ≠ orders ${sold}`
          )
        }
      }
    }
  }

  return violations
}

/** Whether the lot's price was changed after the handover (reprice/correction) — I7 allows that. */
async function repricedSince(client: QueryClientContract, lotId: number, originId: number) {
  const row = await client
    .from('delivery_corrections')
    .whereIn('delivery_id', [lotId, originId])
    .whereIn('kind', ['reprice', 'update'])
    .first()
  return !!row
}

export async function assertStockInvariants(assert: Assert, options: StockInvariantOptions = {}) {
  const violations = await collectStockViolations(options)
  assert.deepEqual(violations, [], `stock invariants broken:\n${violations.join('\n')}`)
}
