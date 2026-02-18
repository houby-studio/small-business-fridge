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

    AuditService.log(supplierId, 'delivery.created', 'delivery', delivery.id, null, {
      productId,
      amount,
      price,
    })

    return delivery
  }

  /**
   * Get stock overview for a supplier — all their deliveries with product info.
   * Groups by product, shows supplied/remaining/sold amounts.
   */
  async getStockForSupplier(supplierId: number) {
    const rows = await db
      .from('deliveries')
      .join('products', 'deliveries.product_id', 'products.id')
      .leftJoin('categories', 'products.category_id', 'categories.id')
      .where('deliveries.supplier_id', supplierId)
      .select(
        'products.id as product_id',
        'products.display_name as product_name',
        'products.image_path',
        'categories.name as category_name',
        'categories.color as category_color',
        db.rawQuery('SUM(deliveries.amount_supplied)::int as total_supplied'),
        db.rawQuery('SUM(deliveries.amount_left)::int as total_remaining'),
        db.rawQuery('SUM(deliveries.amount_supplied - deliveries.amount_left)::int as total_sold'),
        db.rawQuery('COUNT(deliveries.id)::int as delivery_count'),
        db.rawQuery(
          'SUM(deliveries.price * (deliveries.amount_supplied - deliveries.amount_left))::numeric as total_revenue'
        )
      )
      .groupBy(
        'products.id',
        'products.display_name',
        'products.image_path',
        'categories.name',
        'categories.color'
      )
      .orderBy('products.display_name', 'asc')

    return rows.map((r) => ({
      productId: r.product_id,
      productName: r.product_name,
      imagePath: normalizeImagePath(r.image_path),
      categoryName: r.category_name,
      categoryColor: r.category_color,
      totalSupplied: r.total_supplied,
      totalRemaining: r.total_remaining,
      totalSold: r.total_sold,
      deliveryCount: r.delivery_count,
      totalRevenue: Number(r.total_revenue),
    }))
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

  /**
   * Get all products (for the delivery form dropdown).
   */
  async getAllProducts() {
    return Product.query().preload('category').orderBy('displayName', 'asc')
  }
}
