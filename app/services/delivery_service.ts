import { DateTime } from 'luxon'
import Delivery from '#models/delivery'
import DeliveryCorrection from '#models/delivery_correction'
import Product from '#models/product'
import type User from '#models/user'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import AuditService from '#services/audit_service'
import { DomainError } from '#services/domain_error'
import { normalizeImagePath } from '#helpers/image_url'
import { roundMoney, suggestSellingPrice } from '#services/shopping/pricing'

/** A repeated delivery of the same product by the same supplier within this window is flagged. */
export const DUPLICATE_WINDOW_MINUTES = 30
/**
 * A price is flagged when it is this many times higher or lower than the product's last
 * delivery AND differs by more than UNUSUAL_PRICE_MIN_DIFF — the ratio alone would fire on
 * every cheap item (2 → 3 Kč is already 1.5×).
 */
export const UNUSUAL_PRICE_RATIO = 1.5
export const UNUSUAL_PRICE_MIN_DIFF = 5
/** A product with this many pieces or fewer counts as low on stock. */
export const LOW_STOCK_THRESHOLD = 4

export type AddStockErrorCode = 'PRICE_REQUIRED'

export type DeliveryCorrectionErrorCode =
  | 'DELIVERY_NOT_FOUND'
  | 'FORBIDDEN'
  | 'DELIVERY_VOIDED'
  | 'AMOUNT_BELOW_SOLD'
  | 'AMOUNT_INCREASE_NOT_ALLOWED'
  | 'NO_CHANGE'
  | 'DELIVERY_HAS_ORDERS'

/** Whose deliveries a listing covers: the whole fridge or only the viewer's own lots. */
export type StockScope = 'all' | 'mine'
export type StockState = 'all' | 'low' | 'out'

export interface StockWarnings {
  duplicate: { amount: number; price: number; minutesAgo: number } | null
  unusualPrice: {
    lastPrice: number
    lastSupplierId: number
    lastSupplierName: string
    lastCreatedAt: string
  } | null
}

export interface StockRow {
  productId: number
  productName: string
  imagePath: string | null
  categoryName: string | null
  categoryColor: string | null
  totalSupplied: number
  totalRemaining: number
  totalSold: number
  deliveryCount: number
  totalStockValue: number
  /** Pieces sold in the last 30 days. */
  soldInPeriod: number
  /** Deliveries stocked in the last 30 days. */
  deliveredInPeriod: number
}

export interface StockInsights {
  lowStockCount: number
  outOfStockCount: number
  activeProducts: number
  period: '30d'
  categoryBreakdown: Array<{
    categoryName: string | null
    categoryColor: string | null
    totalRemaining: number
    productCount: number
  }>
  lowStockItems: StockRow[]
  topMovers: StockRow[]
}

export interface StockOverview {
  data: StockRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
  totals: { totalProducts: number; totalRemaining: number; totalStockValue: number }
  /** Products with LOW_STOCK_THRESHOLD pieces or fewer — regardless of the stockState filter. */
  lowStockCount: number
  /** Only computed with `withInsights` (the MCP get_stock tool); the web does not need it. */
  insights?: StockInsights
}

export interface StockFilters {
  categoryId?: number
  sortBy?: string
  sortOrder?: string
  scope?: StockScope
  stockState?: StockState
  withInsights?: boolean
}

export interface DeliveryCorrectionResult {
  delivery: Delivery
  correction: DeliveryCorrection
  /** Orders whose price this correction changed — captured inside the transaction. */
  repricedOrderIds: number[]
}

type CorrectionActor = Pick<User, 'id' | 'role'>

export interface CorrectionOptions {
  /** The admin really acting, when they impersonate `actor` (set by the controller). */
  impersonatorId?: number
}

export interface CorrectionInput {
  amount: number
  price: number
  /** Omitted = unchanged, null = clear, number = the corrected purchase price. */
  purchasePrice?: number | null
  reason: string
}

const STOCK_SORT_COLUMNS: Record<string, string> = {
  productName: 'product_name',
  totalRemaining: 'total_remaining',
  totalSold: 'total_sold',
  soldInPeriod: 'sold_in_period',
  totalStockValue: 'total_stock_value',
  totalSupplied: 'total_supplied',
}

export default class DeliveryService {
  /**
   * Add stock for a product — create a new delivery record. `purchasePrice` is what the
   * supplier paid per piece, when they track it. Without a selling price it is derived from
   * the purchase price and `marginPercent`. Pass `client` to stock inside a larger
   * transaction (a bulk draft): the audit entry then rolls back with it. `actorId` is who
   * really stocked when it is not the supplier (an admin committing their draft).
   */
  async addStock(
    supplierId: number,
    productId: number,
    amount: number,
    price: number | null,
    options: {
      purchasePrice?: number | null
      marginPercent?: number
      actorId?: number
      client?: TransactionClientContract
    } = {}
  ): Promise<Delivery> {
    const purchasePrice =
      options.purchasePrice === null || options.purchasePrice === undefined
        ? null
        : roundMoney(options.purchasePrice)
    const unitPrice =
      price ??
      (purchasePrice === null
        ? null
        : suggestSellingPrice(purchasePrice, options.marginPercent ?? 0))
    if (unitPrice === null) throw new DomainError<AddStockErrorCode>('PRICE_REQUIRED')

    const delivery = await Delivery.create(
      {
        supplierId,
        productId,
        amountSupplied: amount,
        amountLeft: amount,
        amountLost: 0,
        price: unitPrice,
        purchasePrice,
      },
      { client: options.client }
    )

    const actorId = options.actorId ?? supplierId
    await AuditService.log(
      actorId,
      'delivery.created',
      'delivery',
      delivery.id,
      actorId !== supplierId ? supplierId : null,
      { productId, amount, price: unitPrice, ...(purchasePrice !== null && { purchasePrice }) },
      { client: options.client }
    )

    return delivery
  }

  /**
   * Cheap sanity checks run before a delivery is created, so an accidental double submit
   * or a mistyped price is caught while it is still free to fix. Returns null when there
   * is nothing to confirm.
   */
  async getStockWarnings(
    supplierId: number,
    productId: number,
    price: number
  ): Promise<StockWarnings | null> {
    const since = DateTime.now().minus({ minutes: DUPLICATE_WINDOW_MINUTES })

    const [recentOwn, lastDelivery] = await Promise.all([
      Delivery.query()
        .where('supplierId', supplierId)
        .where('productId', productId)
        .whereNull('voidedAt')
        .where('createdAt', '>=', since.toJSDate())
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .first(),
      Delivery.query()
        .where('productId', productId)
        .whereNull('voidedAt')
        .preload('supplier')
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .first(),
    ])

    const duplicate = recentOwn
      ? {
          amount: recentOwn.amountSupplied,
          price: recentOwn.price,
          minutesAgo: Math.max(
            0,
            Math.floor(DateTime.now().diff(recentOwn.createdAt, 'minutes').minutes)
          ),
        }
      : null

    const unusualPrice =
      lastDelivery &&
      Math.abs(price - lastDelivery.price) > UNUSUAL_PRICE_MIN_DIFF &&
      (price >= lastDelivery.price * UNUSUAL_PRICE_RATIO ||
        price * UNUSUAL_PRICE_RATIO <= lastDelivery.price)
        ? {
            lastPrice: lastDelivery.price,
            lastSupplierId: lastDelivery.supplierId,
            lastSupplierName: lastDelivery.supplier?.displayName ?? '—',
            lastCreatedAt: lastDelivery.createdAt.toISO() ?? '',
          }
        : null

    return duplicate || unusualPrice ? { duplicate, unusualPrice } : null
  }

  /**
   * Correct the amount, the selling price and/or the purchase price of a delivery after it
   * was stocked.
   *
   * - The amount can only go down, and never below what was already sold. Topping up an old
   *   delivery would let it jump the FIFO queue ahead of newer deliveries by other
   *   suppliers, so extra pieces always come in as a new delivery.
   * - A new selling price applies to the remaining stock and to every purchase from this
   *   delivery that is not invoiced yet. Invoiced purchases keep their price — an issued
   *   invoice never changes.
   * - The purchase price is the supplier's own cost; changing it never touches an order.
   *
   * The delivery row is locked first (as purchases do), then the uninvoiced orders (as
   * invoice generation does), so neither can interleave with the correction.
   */
  async correctDelivery(
    actor: CorrectionActor,
    deliveryId: number,
    input: CorrectionInput,
    options: CorrectionOptions = {}
  ): Promise<DeliveryCorrectionResult> {
    const result = await db.transaction(async (trx) => {
      const delivery = await this.lockForCorrection(actor, deliveryId, trx)

      const sold = delivery.amountSupplied - delivery.amountLeft
      if (input.amount > delivery.amountSupplied) {
        throw new DomainError<DeliveryCorrectionErrorCode>('AMOUNT_INCREASE_NOT_ALLOWED')
      }
      if (input.amount < sold) {
        throw new DomainError<DeliveryCorrectionErrorCode>('AMOUNT_BELOW_SOLD')
      }

      const priceChanged = input.price !== delivery.price
      const newPurchasePrice =
        input.purchasePrice === undefined
          ? delivery.purchasePrice
          : input.purchasePrice === null
            ? null
            : roundMoney(input.purchasePrice)
      const purchasePriceChanged = newPurchasePrice !== delivery.purchasePrice
      if (input.amount === delivery.amountSupplied && !priceChanged && !purchasePriceChanged) {
        throw new DomainError<DeliveryCorrectionErrorCode>('NO_CHANGE')
      }

      const correction = await DeliveryCorrection.create(
        {
          deliveryId: delivery.id,
          actorId: actor.id,
          impersonatorId: options.impersonatorId ?? null,
          kind: 'update',
          reason: input.reason,
          oldAmountSupplied: delivery.amountSupplied,
          newAmountSupplied: input.amount,
          oldPrice: delivery.price,
          newPrice: input.price,
          oldPurchasePrice: delivery.purchasePrice,
          newPurchasePrice,
          repricedOrderCount: 0,
        },
        { client: trx }
      )

      let repricedOrderIds: number[] = []
      if (priceChanged) {
        const uninvoiced = await trx
          .from('orders')
          .where('delivery_id', delivery.id)
          .whereNull('invoice_id')
          // Orders are always locked by id, as invoice generation does — any other order
          // could deadlock against it.
          .orderBy('id', 'asc')
          .forUpdate()
          .select('id')

        if (uninvoiced.length > 0) {
          const repriced = await trx
            .from('orders')
            .whereIn(
              'id',
              uninvoiced.map((row) => row.id)
            )
            .whereNull('invoice_id')
            .update({
              original_unit_price: trx.raw('COALESCE(original_unit_price, unit_price)'),
              unit_price: input.price,
              price_correction_id: correction.id,
              updated_at: new Date(),
            })
          repricedOrderIds = uninvoiced.map((row) => Number(row.id))
          correction.repricedOrderCount = Array.isArray(repriced)
            ? repriced.length
            : Number(repriced)
          await correction.save()
        }
      }

      delivery.amountSupplied = input.amount
      delivery.amountLeft = input.amount - sold
      delivery.price = input.price
      delivery.purchasePrice = newPurchasePrice
      await delivery.save()

      return { delivery, correction, repricedOrderIds }
    })

    const { delivery, correction } = result
    await AuditService.log(
      actor.id,
      'delivery.corrected',
      'delivery',
      delivery.id,
      delivery.supplierId === actor.id ? null : delivery.supplierId,
      {
        productId: delivery.productId,
        reason: correction.reason,
        // Only what actually changed — an unchanged "999 → 999" reads like a change.
        ...(correction.oldAmountSupplied !== correction.newAmountSupplied && {
          amountSupplied: { from: correction.oldAmountSupplied, to: correction.newAmountSupplied },
        }),
        ...(correction.oldPrice !== correction.newPrice && {
          price: { from: correction.oldPrice, to: correction.newPrice },
          repricedOrderCount: correction.repricedOrderCount,
        }),
        ...(correction.oldPurchasePrice !== correction.newPurchasePrice && {
          purchasePrice: { from: correction.oldPurchasePrice, to: correction.newPurchasePrice },
        }),
      }
    )

    return result
  }

  /**
   * Void a delivery nothing was sold from — typically a duplicate. The row is kept (with
   * both amounts zeroed and `voided_at` set) so the history and audit trail stay intact;
   * the original numbers live on the correction record.
   */
  async voidDelivery(
    actor: CorrectionActor,
    deliveryId: number,
    reason: string,
    options: CorrectionOptions = {}
  ): Promise<DeliveryCorrectionResult> {
    const result = await db.transaction(async (trx) => {
      const delivery = await this.lockForCorrection(actor, deliveryId, trx)

      const orderCount = await trx
        .from('orders')
        .where('delivery_id', delivery.id)
        .count('* as total')
        .first()
      if (Number(orderCount?.total ?? 0) > 0 || delivery.amountLeft !== delivery.amountSupplied) {
        throw new DomainError<DeliveryCorrectionErrorCode>('DELIVERY_HAS_ORDERS')
      }

      const correction = await DeliveryCorrection.create(
        {
          deliveryId: delivery.id,
          actorId: actor.id,
          impersonatorId: options.impersonatorId ?? null,
          kind: 'void',
          reason,
          oldAmountSupplied: delivery.amountSupplied,
          newAmountSupplied: 0,
          oldPrice: delivery.price,
          newPrice: delivery.price,
          oldPurchasePrice: delivery.purchasePrice,
          newPurchasePrice: delivery.purchasePrice,
          repricedOrderCount: 0,
        },
        { client: trx }
      )

      delivery.amountSupplied = 0
      delivery.amountLeft = 0
      delivery.voidedAt = DateTime.now()
      await delivery.save()

      return { delivery, correction, repricedOrderIds: [] }
    })

    const { delivery, correction } = result
    await AuditService.log(
      actor.id,
      'delivery.voided',
      'delivery',
      delivery.id,
      delivery.supplierId === actor.id ? null : delivery.supplierId,
      {
        productId: delivery.productId,
        reason,
        amountSupplied: correction.oldAmountSupplied,
        price: correction.oldPrice,
      }
    )

    return result
  }

  private async lockForCorrection(
    actor: CorrectionActor,
    deliveryId: number,
    trx: TransactionClientContract
  ): Promise<Delivery> {
    const delivery = await Delivery.query({ client: trx })
      .where('id', deliveryId)
      .forUpdate()
      .first()

    if (!delivery) {
      throw new DomainError<DeliveryCorrectionErrorCode>('DELIVERY_NOT_FOUND')
    }
    if (actor.role !== 'admin' && delivery.supplierId !== actor.id) {
      throw new DomainError<DeliveryCorrectionErrorCode>('FORBIDDEN')
    }
    if (delivery.voidedAt) {
      throw new DomainError<DeliveryCorrectionErrorCode>('DELIVERY_VOIDED')
    }

    return delivery
  }

  /**
   * Stock overview grouped by product: supplied / remaining / sold, stock value and the
   * last 30 days of activity. `scope` narrows it to the viewer's own lots, `stockState` to
   * products running low or sold out. Sorted, filtered and paginated in SQL; the totals and
   * the low-stock count always cover every product of the scope and category.
   */
  async getStockForSupplier(
    supplierId: number,
    page: number = 1,
    perPage: number = 20,
    filters: StockFilters = {}
  ): Promise<StockOverview> {
    const scope: StockScope = filters.scope === 'mine' ? 'mine' : 'all'
    const stockState: StockState =
      filters.stockState === 'low' || filters.stockState === 'out' ? filters.stockState : 'all'
    const sortColumn = STOCK_SORT_COLUMNS[filters.sortBy ?? ''] ?? 'product_name'
    const sortDir: 'asc' | 'desc' = filters.sortOrder === 'desc' ? 'desc' : 'asc'
    const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const bindings: Record<string, unknown> = {
      supplierId,
      categoryId: filters.categoryId ?? null,
      periodStart,
      lowThreshold: LOW_STOCK_THRESHOLD,
    }
    const mine = scope === 'mine'
    const ownOnly = (column: string) => (mine ? `AND ${column} = :supplierId` : '')
    const byCategory = filters.categoryId ? 'AND p.category_id = :categoryId' : ''

    // Every product of the scope with its lots summed up; the 30-day activity comes from two
    // small grouped subqueries joined in, so a page can be sorted by it in SQL.
    const grouped = `
      WITH sold AS (
        SELECT d.product_id, COUNT(*)::int AS sold_in_period
          FROM orders o
          JOIN deliveries d ON d.id = o.delivery_id
         WHERE o.created_at >= :periodStart ${ownOnly('d.supplier_id')}
         GROUP BY d.product_id
      ), delivered AS (
        SELECT product_id, COUNT(*)::int AS delivered_in_period
          FROM deliveries
         WHERE voided_at IS NULL AND created_at >= :periodStart ${ownOnly('supplier_id')}
         GROUP BY product_id
      ), grouped AS (
        SELECT p.id AS product_id,
               p.display_name AS product_name,
               p.image_path,
               c.name AS category_name,
               c.color AS category_color,
               SUM(d.amount_supplied)::int AS total_supplied,
               SUM(d.amount_left)::int AS total_remaining,
               SUM(d.amount_supplied - d.amount_left - d.amount_lost)::int AS total_sold,
               COUNT(d.id)::int AS delivery_count,
               SUM(d.price * d.amount_left)::numeric AS total_stock_value,
               COALESCE(s.sold_in_period, 0)::int AS sold_in_period,
               COALESCE(dl.delivered_in_period, 0)::int AS delivered_in_period
          FROM deliveries d
          JOIN products p ON p.id = d.product_id
          LEFT JOIN categories c ON c.id = p.category_id
          LEFT JOIN sold s ON s.product_id = p.id
          LEFT JOIN delivered dl ON dl.product_id = p.id
         WHERE d.voided_at IS NULL ${ownOnly('d.supplier_id')} ${byCategory}
         GROUP BY p.id, p.display_name, p.image_path, c.name, c.color,
                  s.sold_in_period, dl.delivered_in_period
      )`
    const stateWhere =
      stockState === 'out'
        ? 'WHERE total_remaining = 0'
        : stockState === 'low'
          ? 'WHERE total_remaining BETWEEN 1 AND :lowThreshold'
          : ''

    type Rows<T> = { rows: T[] }
    const [pageRows, summary] = await Promise.all([
      db.rawQuery<Rows<Record<string, any>>>(
        `${grouped}
         SELECT * FROM grouped ${stateWhere}
          ORDER BY ${sortColumn} ${sortDir}, product_name ASC, product_id ASC
          LIMIT :limit OFFSET :offset`,
        { ...bindings, limit: perPage, offset: (page - 1) * perPage }
      ),
      db.rawQuery<Rows<Record<string, any>>>(
        `${grouped}
         SELECT COUNT(*)::int AS total_products,
                COALESCE(SUM(total_remaining), 0)::int AS total_remaining,
                COALESCE(SUM(total_stock_value), 0)::numeric AS total_stock_value,
                COUNT(*) FILTER (WHERE total_remaining = 0)::int AS out_count,
                COUNT(*) FILTER (WHERE total_remaining BETWEEN 1 AND :lowThreshold)::int AS low_count
           FROM grouped`,
        bindings
      ),
    ])

    const sums = summary.rows[0] ?? {}
    const totalProducts = Number(sums.total_products ?? 0)
    const outCount = Number(sums.out_count ?? 0)
    const lowCount = Number(sums.low_count ?? 0)
    const total = stockState === 'out' ? outCount : stockState === 'low' ? lowCount : totalProducts

    const overview: StockOverview = {
      data: pageRows.rows.map(DeliveryService.mapStockRow),
      meta: {
        total,
        perPage,
        currentPage: page,
        lastPage: Math.max(1, Math.ceil(total / perPage)),
      },
      totals: {
        totalProducts,
        totalRemaining: Number(sums.total_remaining ?? 0),
        totalStockValue: Number(sums.total_stock_value ?? 0),
      },
      lowStockCount: lowCount + outCount,
    }

    if (filters.withInsights) {
      const all = await db.rawQuery<Rows<Record<string, any>>>(
        `${grouped} SELECT * FROM grouped ORDER BY product_name ASC`,
        bindings
      )
      overview.insights = DeliveryService.buildInsights(all.rows.map(DeliveryService.mapStockRow))
    }

    return overview
  }

  private static mapStockRow(r: Record<string, any>): StockRow {
    return {
      productId: Number(r.product_id),
      productName: r.product_name,
      imagePath: normalizeImagePath(r.image_path),
      categoryName: r.category_name ?? null,
      categoryColor: r.category_color ?? null,
      totalSupplied: Number(r.total_supplied),
      totalRemaining: Number(r.total_remaining),
      totalSold: Number(r.total_sold),
      deliveryCount: Number(r.delivery_count),
      totalStockValue: Number(r.total_stock_value),
      soldInPeriod: Number(r.sold_in_period),
      deliveredInPeriod: Number(r.delivered_in_period),
    }
  }

  private static buildInsights(rows: StockRow[]): StockInsights {
    const lowStockItems = rows
      .filter(
        (r) =>
          r.totalRemaining > 0 &&
          r.totalRemaining <= LOW_STOCK_THRESHOLD &&
          (r.soldInPeriod > 0 || r.deliveredInPeriod > 0)
      )
      .sort((a, b) => {
        if (a.totalRemaining !== b.totalRemaining) return a.totalRemaining - b.totalRemaining
        return b.soldInPeriod - a.soldInPeriod
      })
      .slice(0, 12)

    const topMovers = rows
      .filter((r) => r.soldInPeriod > 0)
      .sort((a, b) => b.soldInPeriod - a.soldInPeriod)
      .slice(0, 8)

    const categoryMap = new Map<string, StockInsights['categoryBreakdown'][number]>()
    for (const row of rows) {
      const key = row.categoryName ?? '__uncategorized__'
      const current = categoryMap.get(key) ?? {
        categoryName: row.categoryName ?? null,
        categoryColor: row.categoryColor,
        totalRemaining: 0,
        productCount: 0,
      }
      current.totalRemaining += row.totalRemaining
      if (row.totalRemaining > 0) current.productCount += 1
      categoryMap.set(key, current)
    }

    return {
      lowStockCount: lowStockItems.length,
      outOfStockCount: rows.filter((r) => r.totalRemaining === 0).length,
      activeProducts: rows.filter((r) => r.totalRemaining > 0).length,
      period: '30d',
      categoryBreakdown: [...categoryMap.values()].sort(
        (a, b) => b.totalRemaining - a.totalRemaining
      ),
      lowStockItems,
      topMovers,
    }
  }

  /**
   * Get recent deliveries for a supplier (or the whole fridge) with optional product filter
   * and sort. Corrections are preloaded newest first so the history can show them.
   */
  async getRecentDeliveries(
    supplierId: number,
    page: number = 1,
    perPage: number = 20,
    filters?: {
      productId?: number
      sortBy?: string
      sortOrder?: string
      scope?: StockScope
    }
  ) {
    const SORT_WHITELIST = ['createdAt', 'price']
    const safeSort = SORT_WHITELIST.includes(filters?.sortBy ?? '') ? filters!.sortBy! : 'createdAt'
    const sortDir: 'asc' | 'desc' = filters?.sortOrder === 'asc' ? 'asc' : 'desc'

    const query = Delivery.query()
      .preload('product', (q) => q.preload('category'))
      .preload('supplier')
      .preload('corrections', (q) => q.orderBy('createdAt', 'desc').orderBy('id', 'desc'))
      .orderBy(safeSort, sortDir)
      .orderBy('id', sortDir)

    if (filters?.scope !== 'all') {
      query.where('supplierId', supplierId)
    }

    if (filters?.productId) {
      query.where('productId', filters.productId)
    }

    return query.paginate(page, perPage)
  }

  /**
   * Per-delivery purchase counts the correction dialog needs to show its impact preview:
   * how many units are invoiced (their price is final) and how many purchases, by how many
   * buyers, a price correction would still reach.
   */
  async getOrderStatsForDeliveries(deliveryIds: number[]) {
    const stats = new Map<
      number,
      { invoicedCount: number; uninvoicedCount: number; uninvoicedBuyerCount: number }
    >()
    if (deliveryIds.length === 0) return stats

    const rows = await db
      .from('orders')
      .whereIn('delivery_id', deliveryIds)
      .groupBy('delivery_id')
      .select('delivery_id')
      .select(db.rawQuery('COUNT(*) FILTER (WHERE invoice_id IS NOT NULL)::int as invoiced'))
      .select(db.rawQuery('COUNT(*) FILTER (WHERE invoice_id IS NULL)::int as uninvoiced'))
      .select(
        db.rawQuery(
          'COUNT(DISTINCT buyer_id) FILTER (WHERE invoice_id IS NULL)::int as uninvoiced_buyers'
        )
      )

    for (const row of rows) {
      stats.set(Number(row.delivery_id), {
        invoicedCount: Number(row.invoiced),
        uninvoicedCount: Number(row.uninvoiced),
        uninvoicedBuyerCount: Number(row.uninvoiced_buyers),
      })
    }
    return stats
  }

  /**
   * Get all products (for the delivery history filter).
   */
  async getAllProducts() {
    return Product.query().preload('category').orderBy('displayName', 'asc')
  }

  /**
   * Selling and purchase price of every product's newest lot (or only of `productIds`) —
   * the stocking form shows them as a reminder and suggests them for the next lot.
   */
  async getLastPrices(
    productIds?: number[]
  ): Promise<Map<number, { price: number; purchasePrice: number | null }>> {
    if (productIds && productIds.length === 0) return new Map()
    const result = await db.rawQuery<{
      rows: Array<{ product_id: number; price: number; purchase_price: string | null }>
    }>(
      `SELECT DISTINCT ON (product_id) product_id, price, purchase_price
         FROM deliveries
        WHERE voided_at IS NULL
          ${productIds ? 'AND product_id = ANY(:productIds)' : ''}
        ORDER BY product_id, created_at DESC, id DESC`,
      productIds ? { productIds } : {}
    )
    return new Map(
      result.rows.map((row) => [
        Number(row.product_id),
        {
          price: Number(row.price),
          purchasePrice: row.purchase_price === null ? null : Number(row.purchase_price),
        },
      ])
    )
  }
}
