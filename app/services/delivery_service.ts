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

/** A repeated delivery of the same product by the same supplier within this window is flagged. */
export const DUPLICATE_WINDOW_MINUTES = 30
/**
 * A price is flagged when it is this many times higher or lower than the product's last
 * delivery AND differs by more than UNUSUAL_PRICE_MIN_DIFF — the ratio alone would fire on
 * every cheap item (2 → 3 Kč is already 1.5×).
 */
export const UNUSUAL_PRICE_RATIO = 1.5
export const UNUSUAL_PRICE_MIN_DIFF = 5

export type DeliveryCorrectionErrorCode =
  | 'DELIVERY_NOT_FOUND'
  | 'FORBIDDEN'
  | 'DELIVERY_VOIDED'
  | 'AMOUNT_BELOW_SOLD'
  | 'AMOUNT_INCREASE_NOT_ALLOWED'
  | 'NO_CHANGE'
  | 'DELIVERY_HAS_ORDERS'

export interface StockWarnings {
  duplicate: { amount: number; price: number; minutesAgo: number } | null
  unusualPrice: {
    lastPrice: number
    lastSupplierId: number
    lastSupplierName: string
    lastCreatedAt: string
  } | null
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

export default class DeliveryService {
  /**
   * Add stock for a product — create a new delivery record.
   */
  async addStock(
    supplierId: number,
    productId: number,
    amount: number,
    price: number
  ): Promise<Delivery> {
    const delivery = await Delivery.create({
      supplierId,
      productId,
      amountSupplied: amount,
      amountLeft: amount,
      price,
    })

    await AuditService.log(supplierId, 'delivery.created', 'delivery', delivery.id, null, {
      productId,
      amount,
      price,
    })

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
   * Correct the amount and/or price of a delivery after it was stocked.
   *
   * - The amount can only go down, and never below what was already sold. Topping up an old
   *   delivery would let it jump the FIFO queue ahead of newer deliveries by other
   *   suppliers, so extra pieces always come in as a new delivery.
   * - A new price applies to the remaining stock and to every purchase from this delivery
   *   that is not invoiced yet. Invoiced purchases keep their price — an issued invoice
   *   never changes.
   *
   * The delivery row is locked first (as purchases do), then the uninvoiced orders (as
   * invoice generation does), so neither can interleave with the correction.
   */
  async correctDelivery(
    actor: CorrectionActor,
    deliveryId: number,
    input: { amount: number; price: number; reason: string },
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
      if (input.amount === delivery.amountSupplied && !priceChanged) {
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
   * Get stock overview for a supplier — all their deliveries with product info.
   * Groups by product, shows supplied/remaining/sold amounts.
   * Supports filtering by category, sorting, and pagination.
   * Activity insights are calculated from the last 30 days.
   */
  async getStockForSupplier(
    supplierId: number,
    page: number = 1,
    perPage: number = 20,
    filters?: {
      categoryId?: number
      sortBy?: string
      sortOrder?: string
      scope?: 'store' | 'mine'
    }
  ) {
    const sortByMap: Record<string, string> = {
      productName: 'product_name',
      totalRemaining: 'total_remaining',
      totalSold: 'total_sold',
    }
    const safeSort = sortByMap[filters?.sortBy ?? ''] ?? 'product_name'
    const sortDir: 'asc' | 'desc' = filters?.sortOrder === 'asc' ? 'asc' : 'desc'
    const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    let query = db
      .from('deliveries')
      .join('products', 'deliveries.product_id', 'products.id')
      .leftJoin('categories', 'products.category_id', 'categories.id')
      .whereNull('deliveries.voided_at')
      .select(
        'products.id as product_id',
        'products.display_name as product_name',
        'products.image_path',
        'categories.id as category_id',
        'categories.name as category_name',
        'categories.color as category_color',
        db.rawQuery('SUM(deliveries.amount_supplied)::int as total_supplied'),
        db.rawQuery('SUM(deliveries.amount_left)::int as total_remaining'),
        db.rawQuery('SUM(deliveries.amount_supplied - deliveries.amount_left)::int as total_sold'),
        db.rawQuery('COUNT(deliveries.id)::int as delivery_count'),
        db.rawQuery('SUM(deliveries.price * deliveries.amount_left)::numeric as total_stock_value')
      )
      .groupBy(
        'products.id',
        'products.display_name',
        'products.image_path',
        'categories.id',
        'categories.name',
        'categories.color'
      )

    if (filters?.scope === 'mine') {
      query = query.where('deliveries.supplier_id', supplierId)
    }

    if (filters?.categoryId) {
      query = query.where('products.category_id', filters.categoryId)
    }

    query = query.orderByRaw(`${safeSort} ${sortDir}`)

    const allRows = await query

    const allMapped = allRows.map((r) => ({
      productId: r.product_id,
      productName: r.product_name,
      imagePath: normalizeImagePath(r.image_path),
      categoryName: r.category_name,
      categoryColor: r.category_color,
      totalSupplied: r.total_supplied,
      totalRemaining: r.total_remaining,
      totalSold: r.total_sold,
      deliveryCount: r.delivery_count,
      totalStockValue: Number(r.total_stock_value),
    }))

    const productIds = allMapped.map((r) => r.productId)
    let soldInPeriodByProduct = new Map<number, number>()
    let deliveredInPeriodByProduct = new Map<number, number>()

    if (productIds.length > 0) {
      let soldQuery = db
        .from('orders')
        .join('deliveries', 'orders.delivery_id', 'deliveries.id')
        .whereIn('deliveries.product_id', productIds)
        .where('orders.created_at', '>=', periodStart)
        .groupBy('deliveries.product_id')
        .select('deliveries.product_id as productId')
        .select(db.rawQuery('COUNT(*)::int as sold_in_period'))

      let deliveredQuery = db
        .from('deliveries')
        .whereIn('deliveries.product_id', productIds)
        .whereNull('deliveries.voided_at')
        .where('deliveries.created_at', '>=', periodStart)
        .groupBy('deliveries.product_id')
        .select('deliveries.product_id as productId')
        .select(db.rawQuery('COUNT(*)::int as delivered_in_period'))

      if (filters?.scope === 'mine') {
        soldQuery = soldQuery.where('deliveries.supplier_id', supplierId)
        deliveredQuery = deliveredQuery.where('deliveries.supplier_id', supplierId)
      }

      const [soldRows, deliveredRows] = await Promise.all([soldQuery, deliveredQuery])
      soldInPeriodByProduct = new Map(
        soldRows.map((row) => [Number(row.productId), Number(row.sold_in_period)])
      )
      deliveredInPeriodByProduct = new Map(
        deliveredRows.map((row) => [Number(row.productId), Number(row.delivered_in_period)])
      )
    }

    const mappedWithPeriod = allMapped.map((row) => ({
      ...row,
      soldInPeriod: soldInPeriodByProduct.get(row.productId) ?? 0,
      deliveredInPeriod: deliveredInPeriodByProduct.get(row.productId) ?? 0,
    }))

    const total = mappedWithPeriod.length
    const lastPage = Math.max(1, Math.ceil(total / perPage))
    const start = (page - 1) * perPage
    const data = mappedWithPeriod.slice(start, start + perPage)
    const lowStockItems = mappedWithPeriod
      .filter(
        (r) =>
          r.totalRemaining > 0 &&
          r.totalRemaining <= 4 &&
          (r.soldInPeriod > 0 || r.deliveredInPeriod > 0)
      )
      .sort((a, b) => {
        if (a.totalRemaining !== b.totalRemaining) return a.totalRemaining - b.totalRemaining
        return b.soldInPeriod - a.soldInPeriod
      })
      .slice(0, 12)

    const topMovers = mappedWithPeriod
      .filter((r) => r.soldInPeriod > 0)
      .sort((a, b) => b.soldInPeriod - a.soldInPeriod)
      .slice(0, 8)

    const categoryMap = new Map<
      string,
      {
        categoryName: string | null
        categoryColor: string | null
        totalRemaining: number
        productCount: number
      }
    >()
    for (const row of mappedWithPeriod) {
      const key = row.categoryName ?? '__uncategorized__'
      const current = categoryMap.get(key) ?? {
        categoryName: row.categoryName ?? null,
        categoryColor: row.categoryColor,
        totalRemaining: 0,
        productCount: 0,
      }
      current.totalRemaining += row.totalRemaining
      if (row.totalRemaining > 0) {
        current.productCount += 1
      }
      categoryMap.set(key, current)
    }
    const categoryBreakdown = [...categoryMap.values()].sort(
      (a, b) => b.totalRemaining - a.totalRemaining
    )

    return {
      data,
      meta: { total, perPage, currentPage: page, lastPage },
      totals: {
        totalProducts: total,
        totalRemaining: mappedWithPeriod.reduce((s, r) => s + r.totalRemaining, 0),
        totalStockValue: mappedWithPeriod.reduce((s, r) => s + r.totalStockValue, 0),
      },
      insights: {
        lowStockCount: lowStockItems.length,
        outOfStockCount: mappedWithPeriod.filter((r) => r.totalRemaining === 0).length,
        activeProducts: mappedWithPeriod.filter((r) => r.totalRemaining > 0).length,
        period: '30d' as const,
        categoryBreakdown,
        lowStockItems,
        topMovers,
      },
    }
  }

  /**
   * Get recent deliveries for a supplier (or the whole store) with optional product filter
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
      scope?: 'store' | 'mine'
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

    if (filters?.scope !== 'store') {
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

  async getRecentDeliveriesFeed(
    supplierId: number,
    limit: number = 8,
    scope: 'store' | 'mine' = 'store'
  ) {
    const query = Delivery.query()
      .preload('product', (q) => q.preload('category'))
      .preload('supplier')
      .orderBy('createdAt', 'desc')
      .limit(limit)

    if (scope === 'mine') {
      query.where('supplierId', supplierId)
    }

    return query
  }

  /**
   * Get all products (for the delivery form dropdown).
   */
  async getAllProducts() {
    return Product.query().preload('category').orderBy('displayName', 'asc')
  }
}
