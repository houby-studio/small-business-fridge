import Delivery from '#models/delivery'
import Product from '#models/product'
import db from '@adonisjs/lucid/services/db'
import AuditService from '#services/audit_service'
import { normalizeImagePath } from '#helpers/image_url'

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
   * Get recent deliveries for a supplier with optional product filter and sort.
   */
  async getRecentDeliveries(
    supplierId: number,
    page: number = 1,
    perPage: number = 20,
    filters?: { productId?: number; sortBy?: string; sortOrder?: string }
  ) {
    const SORT_WHITELIST = ['createdAt', 'price']
    const safeSort = SORT_WHITELIST.includes(filters?.sortBy ?? '') ? filters!.sortBy! : 'createdAt'
    const sortDir: 'asc' | 'desc' = filters?.sortOrder === 'asc' ? 'asc' : 'desc'

    const query = Delivery.query()
      .where('supplierId', supplierId)
      .preload('product', (q) => q.preload('category'))
      .orderBy(safeSort, sortDir)

    if (filters?.productId) {
      query.where('productId', filters.productId)
    }

    return query.paginate(page, perPage)
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
