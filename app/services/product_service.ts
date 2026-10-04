import Product from '#models/product'
import Category from '#models/category'
import Allergen from '#models/allergen'
import ProductGroup from '#models/product_group'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import app from '@adonisjs/core/services/app'
import { randomUUID } from 'node:crypto'
import { withProductKeypadId } from '#services/product_keypad_id'

export default class ProductService {
  /**
   * Create a new product with required image upload.
   */
  async createProduct(data: {
    displayName: string
    description: string
    categoryId: number
    barcode?: string | null
    image: MultipartFile
    allergenIds?: number[]
    productGroupId?: number | null
  }): Promise<Product> {
    // Save the upload before opening the transaction — it is slow I/O and would hold the
    // keypad-id lock for its duration.
    const imagePath = await this.saveImage(data.image)

    return withProductKeypadId(async (trx, nextKeypadId) => {
      const product = await Product.create(
        {
          keypadId: nextKeypadId,
          displayName: data.displayName,
          description: data.description,
          imagePath,
          categoryId: data.categoryId,
          barcode: data.barcode || null,
          productGroupId: await this.existingGroupId(data.productGroupId),
        },
        { client: trx }
      )

      const ids = data.allergenIds ?? []
      if (ids.length > 0) {
        await product.related('allergens').attach(ids, trx)
      }

      return product
    })
  }

  /**
   * Update an existing product.
   */
  async updateProduct(
    productId: number,
    data: {
      displayName: string
      description: string
      categoryId: number
      barcode?: string | null
      image?: MultipartFile | null
      allergenIds?: number[]
      /** Undefined = keep the current group. */
      productGroupId?: number | null
    }
  ): Promise<Product> {
    const product = await Product.findOrFail(productId)

    product.displayName = data.displayName
    product.description = data.description
    product.categoryId = data.categoryId
    product.barcode = data.barcode || null
    if (data.productGroupId !== undefined) {
      product.productGroupId = await this.existingGroupId(data.productGroupId)
    }

    if (data.image) {
      product.imagePath = await this.saveImage(data.image)
    }

    await product.save()

    if (data.allergenIds !== undefined) {
      await product.related('allergens').sync(data.allergenIds)
    }

    return product
  }

  /**
   * The `{ from, to }` map for a `product.updated` audit entry. Both products need
   * `category` and `allergens` preloaded (and `productGroup` for its name); category,
   * group and allergens are logged by name.
   */
  static auditChanges(
    before: Product,
    after: Product
  ): Record<string, { from: unknown; to: unknown }> {
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    if (before.displayName !== after.displayName) {
      changes.name = { from: before.displayName, to: after.displayName }
    }
    if (before.description !== after.description) {
      changes.description = { from: before.description ?? '—', to: after.description ?? '—' }
    }
    if (before.barcode !== after.barcode) {
      changes.barcode = { from: before.barcode ?? '—', to: after.barcode ?? '—' }
    }
    if (before.categoryId !== after.categoryId) {
      changes.category = {
        from: before.category?.name ?? `#${before.categoryId}`,
        to: after.category?.name ?? `#${after.categoryId}`,
      }
    }
    if ((before.productGroupId ?? null) !== (after.productGroupId ?? null)) {
      changes.productGroup = {
        from:
          before.productGroup?.name ?? (before.productGroupId ? `#${before.productGroupId}` : '—'),
        to: after.productGroup?.name ?? (after.productGroupId ? `#${after.productGroupId}` : '—'),
      }
    }
    if (before.imagePath !== after.imagePath) {
      changes.image = { from: before.imagePath ?? '—', to: after.imagePath ?? '—' }
    }

    const allergenNames = (product: Product) =>
      product.allergens
        .map((a) => a.name)
        .sort((a, b) => a.localeCompare(b))
        .join(', ')
    const beforeAllergens = allergenNames(before)
    const afterAllergens = allergenNames(after)
    if (beforeAllergens !== afterAllergens) {
      changes.allergens = { from: beforeAllergens || '—', to: afterAllergens || '—' }
    }

    return changes
  }

  /**
   * Get all products with category info.
   */
  async getAllProducts() {
    return Product.query().preload('category').orderBy('displayName', 'asc')
  }

  /**
   * Get paginated products with optional search and category filter.
   */
  async getProductsPaginated(
    page: number = 1,
    perPage: number = 20,
    filters?: { search?: string; categoryId?: number }
  ) {
    const query = Product.query()
      .preload('category')
      .preload('allergens')
      .preload('productGroup')
      .orderBy('displayName', 'asc')

    // Every word has to match somewhere: "cola zero" finds "Coca-Cola Zero", in any order.
    for (const token of ProductService.searchTokens(filters?.search)) {
      const term = `%${token}%`
      query.where((q) => {
        q.whereRaw('display_name ILIKE ?', [term]).orWhereRaw('barcode ILIKE ?', [term])
      })
    }

    if (filters?.categoryId) {
      query.where('categoryId', filters.categoryId)
    }

    return query.paginate(page, perPage)
  }

  /** The words of a search, with LIKE wildcards escaped so "0,5_l" means what it says. */
  static searchTokens(search: string | undefined): string[] {
    return (search ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => token.replace(/[\\%_]/g, '\\$&'))
  }

  /**
   * Get a product by ID with relationships.
   */
  async getProduct(productId: number) {
    return Product.query()
      .where('id', productId)
      .preload('category')
      .preload('allergens')
      .preload('productGroup')
      .firstOrFail()
  }

  /** Purchase groups for the product form, alphabetically. */
  async getProductGroups() {
    return ProductGroup.query().orderBy('name', 'asc')
  }

  /** A group id that still exists, or null — a stale form must not fail the whole save. */
  private async existingGroupId(groupId: number | null | undefined): Promise<number | null> {
    if (!groupId) return null
    return (await ProductGroup.find(groupId)) ? groupId : null
  }

  /**
   * Get all active categories for form dropdowns.
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

  /**
   * Save uploaded image to storage and return its path.
   */
  private async saveImage(file: MultipartFile): Promise<string> {
    const fileName = `${randomUUID()}.${file.extname}`
    await file.move(app.makePath('storage/uploads/products'), {
      name: fileName,
    })
    return `/uploads/products/${fileName}`
  }
}
