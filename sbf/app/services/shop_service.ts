import Product from '#models/product'
import Category from '#models/category'
import db from '@adonisjs/lucid/services/db'
import { normalizeImagePath } from '#helpers/image_url'

export default class ShopService {
  /**
   * Get all products with stock info, grouped by category.
   * Optionally filters to only in-stock products.
   */
  async getProducts(options: { showAll?: boolean; userId?: number } = {}) {
    const query = Product.query()
      .preload('category')
      .preload('deliveries', (q) => {
        q.where('amountLeft', '>', 0)
      })
      .whereHas('category', (q) => {
        q.where('isDisabled', false)
      })
      .orderBy('displayName', 'asc')

    const products = await query

    // Calculate stock info and mark favorites
    let favoriteIds: number[] = []
    if (options.userId) {
      const rows = await db
        .from('user_favorites')
        .where('user_id', options.userId)
        .select('product_id')
      favoriteIds = rows.map((r) => r.product_id)
    }

    const result = products
      .map((product) => {
        const stockSum = product.deliveries.reduce((sum, d) => sum + d.amountLeft, 0)
        const cheapestDelivery = product.deliveries
          .filter((d) => d.amountLeft > 0)
          .sort((a, b) => a.price - b.price)[0]

        return {
          id: product.id,
          keypadId: product.keypadId,
          displayName: product.displayName,
          description: product.description,
          imagePath: normalizeImagePath(product.imagePath),
          barcode: product.barcode,
          category: {
            id: product.category.id,
            name: product.category.name,
            color: product.category.color,
          },
          stockSum,
          price: cheapestDelivery?.price ?? null,
          deliveryId: cheapestDelivery?.id ?? null,
          isFavorite: favoriteIds.includes(product.id),
        }
      })
      .filter((p) => options.showAll || p.stockSum > 0)
      .sort((a, b) => {
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1
        return a.displayName.localeCompare(b.displayName, 'cs')
      })

    return result
  }

  /**
   * Get featured products — popular recent purchases blended with low-stock urgency.
   * Score = popularRank * 0.6 + (1 / stockSum) * 0.4
   * Returns same shape as getProducts() items (no isRecommended / isFavorite fields).
   */
  async getFeaturedProducts(limit: number = 8) {
    // Get order counts per product for the last 30 days
    const popularRows = await db
      .from('orders')
      .join('deliveries', 'deliveries.id', 'orders.delivery_id')
      .where('orders.created_at', '>', db.raw(`NOW() - INTERVAL '30 days'`))
      .groupBy('deliveries.product_id')
      .select('deliveries.product_id')
      .count('orders.id as cnt')

    const popularCountMap = new Map(popularRows.map((r) => [Number(r.product_id), Number(r.cnt)]))

    // Get all in-stock products
    const allProducts = await this.getProducts({ showAll: false })

    if (allProducts.length === 0) {
      return []
    }

    // Compute score for each product
    const maxPopular = Math.max(...allProducts.map((p) => popularCountMap.get(p.id) ?? 0), 1)

    const scored = allProducts.map((p) => {
      const popularCount = popularCountMap.get(p.id) ?? 0
      const popularRank = popularCount / maxPopular
      const stockScore = p.stockSum > 0 ? 1 / p.stockSum : 0
      const score = popularRank * 0.6 + stockScore * 0.4
      return { product: p, score }
    })

    scored.sort((a, b) => b.score - a.score)

    return scored.slice(0, limit).map((s) => s.product)
  }

  /**
   * Get all active categories.
   */
  async getCategories() {
    return Category.query().where('isDisabled', false).orderBy('name', 'asc')
  }
}
