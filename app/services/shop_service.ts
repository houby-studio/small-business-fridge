import Product from '#models/product'
import Category from '#models/category'
import Allergen from '#models/allergen'
import db from '@adonisjs/lucid/services/db'
import { normalizeImagePath } from '#helpers/image_url'

interface ProductFilters {
  showAll?: boolean
  userId?: number
}

interface ProductRow {
  id: number
  keypadId: number
  displayName: string
  description: string | null
  imagePath: string | null
  barcode: string | null
  category: {
    id: number
    name: string
    color: string
  }
  allergens: Array<{ id: number; name: string }>
  stockSum: number
  isFavorite: boolean
}

interface DeliveryLot {
  deliveryId: number
  price: number
  amountLeft: number
  createdAt: string
}

export default class ShopService {
  private async getExcludedAllergenIds(userId?: number): Promise<number[]> {
    if (!userId) {
      return []
    }

    const rows = await db
      .from('user_excluded_allergen')
      .where('user_id', userId)
      .orderBy('allergen_id', 'asc')
      .select('allergen_id')
    return rows.map((row) => Number(row.allergen_id))
  }

  private async getFavoriteIds(userId?: number): Promise<number[]> {
    if (!userId) {
      return []
    }

    const rows = await db.from('user_favorites').where('user_id', userId).select('product_id')
    return rows.map((r) => r.product_id)
  }

  private createProductsQuery(excludedAllergenIds: number[]) {
    const query = Product.query()
      .preload('category')
      .preload('allergens')
      .preload('deliveries', (q) => {
        q.where('amountLeft', '>', 0).orderBy('createdAt', 'asc').orderBy('id', 'asc')
      })
      .whereHas('category', (q) => {
        q.where('isDisabled', false)
      })
      .orderBy('displayName', 'asc')

    if (excludedAllergenIds.length > 0) {
      query.whereDoesntHave('allergens', (q) => {
        q.whereIn('allergens.id', excludedAllergenIds)
      })
    }

    return query
  }

  private mapProductBase(product: Product, favoriteIds: number[]): ProductRow {
    const stockSum = product.deliveries.reduce((sum, d) => sum + d.amountLeft, 0)

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
      allergens: product.allergens.map((a) => ({ id: a.id, name: a.name })),
      stockSum,
      isFavorite: favoriteIds.includes(product.id),
    }
  }

  private sortByFavoriteAndName(a: ProductRow, b: ProductRow) {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1
    return a.displayName.localeCompare(b.displayName, 'cs')
  }

  private mapDeliveryLots(product: Product): DeliveryLot[] {
    return product.deliveries
      .filter((d) => d.amountLeft > 0)
      .sort((a, b) => {
        const createdDiff = a.createdAt.toMillis() - b.createdAt.toMillis()
        if (createdDiff !== 0) {
          return createdDiff
        }
        return a.id - b.id
      })
      .map((d) => ({
        deliveryId: d.id,
        price: d.price,
        amountLeft: d.amountLeft,
        createdAt: d.createdAt.toISO() ?? '',
      }))
  }

  /**
   * Get all products with stock info, grouped by category.
   * Optionally filters to only in-stock products.
   */
  async getProducts(options: ProductFilters = {}) {
    const [excludedAllergenIds, favoriteIds] = await Promise.all([
      this.getExcludedAllergenIds(options.userId),
      this.getFavoriteIds(options.userId),
    ])

    const products = await this.createProductsQuery(excludedAllergenIds)

    const result = products
      .map((product) => {
        const mapped = this.mapProductBase(product, favoriteIds)
        const cheapestDelivery = product.deliveries
          .filter((d) => d.amountLeft > 0)
          .sort((a, b) => a.price - b.price)[0]

        return {
          ...mapped,
          price: cheapestDelivery?.price ?? null,
          deliveryId: cheapestDelivery?.id ?? null,
        }
      })
      .filter((p) => options.showAll || p.stockSum > 0)
      .sort((a, b) => this.sortByFavoriteAndName(a, b))

    return result
  }

  /**
   * Kiosk product payload with FIFO delivery lots.
   * price/deliveryId are derived from the first FIFO lot for compatibility.
   */
  async getKioskProducts(options: ProductFilters = {}) {
    const [excludedAllergenIds, favoriteIds] = await Promise.all([
      this.getExcludedAllergenIds(options.userId),
      this.getFavoriteIds(options.userId),
    ])

    const products = await this.createProductsQuery(excludedAllergenIds)

    const result = products
      .map((product) => {
        const mapped = this.mapProductBase(product, favoriteIds)
        const deliveryLots = this.mapDeliveryLots(product)
        const firstLot = deliveryLots[0]

        return {
          ...mapped,
          deliveryLots,
          price: firstLot?.price ?? null,
          deliveryId: firstLot?.deliveryId ?? null,
        }
      })
      .filter((p) => options.showAll || p.stockSum > 0)
      .sort((a, b) => this.sortByFavoriteAndName(a, b))

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
   * Kiosk featured products based on FIFO kiosk stock view.
   */
  async getKioskFeaturedProducts(limit: number = 8) {
    const popularRows = await db
      .from('orders')
      .join('deliveries', 'deliveries.id', 'orders.delivery_id')
      .where('orders.created_at', '>', db.raw(`NOW() - INTERVAL '30 days'`))
      .groupBy('deliveries.product_id')
      .select('deliveries.product_id')
      .count('orders.id as cnt')

    const popularCountMap = new Map(popularRows.map((r) => [Number(r.product_id), Number(r.cnt)]))
    const allProducts = await this.getKioskProducts({ showAll: false })

    if (allProducts.length === 0) {
      return []
    }

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

  /**
   * Get all active allergens.
   */
  async getAllergens() {
    return Allergen.query().where('isDisabled', false).orderBy('name', 'asc')
  }
}
