import Product from '#models/product'
import Category from '#models/category'
import db from '@adonisjs/lucid/services/db'
import { normalizeImagePath } from '#helpers/image_url'

export default class ShopService {
  /**
   * Get all products with stock info, grouped by category.
   * Optionally filters to only in-stock products.
   */
  async getProducts(options: { showAll?: boolean; userId?: number; categoryId?: number } = {}) {
    const query = Product.query()
      .preload('category')
      .preload('deliveries', (q) => {
        q.where('amountLeft', '>', 0)
      })
      .whereHas('category', (q) => {
        q.where('isDisabled', false)
      })
      .orderBy('displayName', 'asc')

    if (options.categoryId) {
      query.where('categoryId', options.categoryId)
    }

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
   * Get all active categories.
   */
  async getCategories() {
    return Category.query().where('isDisabled', false).orderBy('name', 'asc')
  }
}
