import db from '@adonisjs/lucid/services/db'
import type { StockScope } from '#services/delivery_service'
import type { StockAdjustmentKind, StockAdjustmentReason } from '#models/stock_adjustment'

export interface AdjustmentRow {
  id: number
  createdAt: string
  productId: number
  productName: string
  kind: StockAdjustmentKind
  quantity: number
  reason: StockAdjustmentReason
  note: string | null
  /** Purchase price of the lot at the time (null = not recorded). */
  unitCost: number | null
  /** Selling price of the lot at the time. */
  unitPrice: number
  /** Whose lot the pieces came off — FIFO may reach a colleague's delivery. */
  lotSupplierName: string
  actorName: string
  inventoryCountId: number | null
}

export interface AdjustmentList {
  data: AdjustmentRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
}

const SORT_COLUMNS: Record<string, string> = {
  createdAt: 'stock_adjustments.created_at',
  quantity: 'stock_adjustments.quantity',
  productName: 'products.display_name',
}

/**
 * The "history" side of the stock page: write-offs and inventory differences, newest first.
 * Deliveries themselves are listed by `DeliveryService.getRecentDeliveries`.
 */
export default class StockHistoryService {
  /**
   * Write-offs and inventory differences. `scope: 'mine'` keeps the adjustments of lots
   * the viewer owns — what cost them money — whatever colleague recorded them.
   */
  async listAdjustments(
    userId: number,
    page: number = 1,
    perPage: number = 20,
    filters: { scope?: StockScope; productId?: number; sortBy?: string; sortOrder?: string } = {}
  ): Promise<AdjustmentList> {
    const sortColumn = SORT_COLUMNS[filters.sortBy ?? ''] ?? SORT_COLUMNS.createdAt
    const sortDir: 'asc' | 'desc' = filters.sortOrder === 'asc' ? 'asc' : 'desc'

    const base = db
      .from('stock_adjustments')
      .join('products', 'products.id', 'stock_adjustments.product_id')
      .join('users as suppliers', 'suppliers.id', 'stock_adjustments.supplier_id')
      .join('users as actors', 'actors.id', 'stock_adjustments.actor_id')
    if (filters.scope !== 'all') base.where('stock_adjustments.supplier_id', userId)
    if (filters.productId) base.where('stock_adjustments.product_id', filters.productId)

    const [rows, counted] = await Promise.all([
      base
        .clone()
        .orderByRaw(`${sortColumn} ${sortDir}, stock_adjustments.id ${sortDir}`)
        .limit(perPage)
        .offset((page - 1) * perPage)
        .select(
          'stock_adjustments.id',
          'stock_adjustments.created_at',
          'stock_adjustments.product_id',
          'stock_adjustments.kind',
          'stock_adjustments.quantity',
          'stock_adjustments.reason',
          'stock_adjustments.note',
          'stock_adjustments.unit_cost',
          'stock_adjustments.unit_price',
          'stock_adjustments.inventory_count_id',
          'products.display_name as product_name',
          'suppliers.display_name as lot_supplier_name',
          'actors.display_name as actor_name'
        ),
      base.clone().count('* as total').first(),
    ])

    const total = Number(counted?.total ?? 0)
    return {
      data: rows.map((row) => ({
        id: Number(row.id),
        createdAt: new Date(row.created_at).toISOString(),
        productId: Number(row.product_id),
        productName: String(row.product_name),
        kind: row.kind as StockAdjustmentKind,
        quantity: Number(row.quantity),
        reason: row.reason as StockAdjustmentReason,
        note: (row.note as string | null) ?? null,
        unitCost: row.unit_cost === null ? null : Number(row.unit_cost),
        unitPrice: Number(row.unit_price),
        lotSupplierName: String(row.lot_supplier_name),
        actorName: String(row.actor_name),
        inventoryCountId: row.inventory_count_id === null ? null : Number(row.inventory_count_id),
      })),
      meta: {
        total,
        perPage,
        currentPage: page,
        lastPage: Math.max(1, Math.ceil(total / perPage)),
      },
    }
  }
}
