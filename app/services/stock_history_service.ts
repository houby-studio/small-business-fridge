import db from '@adonisjs/lucid/services/db'
import DeliveryService, { type StockScope } from '#services/delivery_service'
import type User from '#models/user'
import type { StockAdjustmentKind, StockAdjustmentReason } from '#models/stock_adjustment'
import { canRevertWriteOff } from '#services/inventory_service'

export interface AdjustmentRow {
  id: number
  createdAt: string
  productId: number
  productName: string
  kind: StockAdjustmentKind
  quantity: number
  reason: StockAdjustmentReason
  note: string | null
  /** Purchase price of the lot (null = not recorded, or a colleague's lot — that is private). */
  unitCost: number | null
  /** Selling price of the lot at the time. */
  unitPrice: number
  /** Whose lot the pieces came off — FIFO may reach a colleague's delivery. */
  lotSupplierName: string
  actorName: string
  inventoryCountId: number | null
  /** Set when the write-off was taken back — the row stays, struck through. */
  revertedAt: string | null
  /** Whether the viewer may take this write-off back now (see `canRevertWriteOff`). */
  revertible: boolean
}

export const ADJUSTMENT_REASONS: StockAdjustmentReason[] = [
  'inventory',
  'damaged',
  'expired',
  'stolen',
  'other',
]

export interface AdjustmentFilters {
  scope?: StockScope
  productId?: number
  /** Only losses with this reason — `inventory` = inventory losses nobody explained yet. */
  reason?: StockAdjustmentReason
  /** `write_off` = recorded by hand with a reason, `inventory` = found by a count. */
  origin?: 'write_off' | 'inventory'
  sortBy?: string
  sortOrder?: string
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
   * the viewer owns — what cost them money — whatever colleague recorded them. The purchase
   * price of a colleague's lot is left out (null) unless the viewer is an admin.
   */
  async listAdjustments(
    viewer: Pick<User, 'id' | 'role'>,
    page: number = 1,
    perPage: number = 20,
    filters: AdjustmentFilters = {}
  ): Promise<AdjustmentList> {
    const sortColumn = SORT_COLUMNS[filters.sortBy ?? ''] ?? SORT_COLUMNS.createdAt
    const sortDir: 'asc' | 'desc' = filters.sortOrder === 'asc' ? 'asc' : 'desc'

    const base = db
      .from('stock_adjustments')
      .join('products', 'products.id', 'stock_adjustments.product_id')
      .join('users as suppliers', 'suppliers.id', 'stock_adjustments.supplier_id')
      .join('users as actors', 'actors.id', 'stock_adjustments.actor_id')
      .join('deliveries', 'deliveries.id', 'stock_adjustments.delivery_id')
    if (filters.scope !== 'all') base.where('stock_adjustments.supplier_id', viewer.id)
    if (filters.productId) base.where('stock_adjustments.product_id', filters.productId)
    // A reason belongs to a loss; a surplus is always "found by an inventory".
    if (filters.reason) {
      base.where('stock_adjustments.kind', 'loss').where('stock_adjustments.reason', filters.reason)
    }
    if (filters.origin === 'write_off') base.whereNull('stock_adjustments.inventory_count_id')
    if (filters.origin === 'inventory') base.whereNotNull('stock_adjustments.inventory_count_id')

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
          'stock_adjustments.supplier_id',
          'stock_adjustments.unit_price',
          'stock_adjustments.inventory_count_id',
          'stock_adjustments.actor_id',
          'stock_adjustments.reverted_at',
          'deliveries.voided_at as lot_voided_at',
          'products.display_name as product_name',
          'suppliers.display_name as lot_supplier_name',
          'actors.display_name as actor_name'
        ),
      base.clone().count('* as total').first(),
    ])

    const total = Number(counted?.total ?? 0)
    const now = new Date()
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
        unitCost:
          row.unit_cost === null ||
          !DeliveryService.canSeePurchasePrice(viewer, Number(row.supplier_id))
            ? null
            : Number(row.unit_cost),
        unitPrice: Number(row.unit_price),
        lotSupplierName: String(row.lot_supplier_name),
        actorName: String(row.actor_name),
        inventoryCountId: row.inventory_count_id === null ? null : Number(row.inventory_count_id),
        revertedAt: row.reverted_at ? new Date(row.reverted_at).toISOString() : null,
        revertible:
          !row.lot_voided_at &&
          canRevertWriteOff(
            {
              kind: row.kind,
              inventoryCountId:
                row.inventory_count_id === null ? null : Number(row.inventory_count_id),
              revertedAt: row.reverted_at,
              actorId: Number(row.actor_id),
              createdAt: new Date(row.created_at),
            },
            viewer,
            now
          ),
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
