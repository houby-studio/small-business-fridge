import Product from '#models/product'
import Category from '#models/category'
import Allergen from '#models/allergen'
import ProductGroup from '#models/product_group'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import app from '@adonisjs/core/services/app'
import { randomUUID } from 'node:crypto'
import { withProductKeypadId } from '#services/product_keypad_id'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import AuditService from '#services/audit_service'
import { DomainError } from '#services/domain_error'

export type ProductStatusFilter = 'active' | 'archived' | 'all'
export const PRODUCT_STATUS_FILTERS: ProductStatusFilter[] = ['active', 'archived', 'all']

export type ArchiveError = 'PRODUCT_NOT_FOUND' | 'PRODUCT_HAS_STOCK' | 'PRODUCT_IN_OPEN_DRAFT'

export default class ProductService {
  /**
   * Archive a product nobody stocks any more. Any supplier or admin may do it, but only
   * while no piece is left in the fridge (non-voided lots) and no open stocking draft has
   * a line with it — otherwise it would vanish from the shop with stock still in it, or
   * the draft would stock a product nobody can see. Idempotent.
   */
  async archive(actorId: number, productId: number): Promise<Product> {
    return db.transaction(async (trx) => {
      const product = await Product.query({ client: trx })
        .where('id', productId)
        .forUpdate()
        .first()
      if (!product) throw new DomainError<ArchiveError>('PRODUCT_NOT_FOUND')
      if (product.archivedAt) return product

      const stock = await trx
        .from('deliveries')
        .where('product_id', productId)
        .whereNull('voided_at')
        .sum('amount_left as left')
        .first()
      if (Number(stock?.left ?? 0) > 0) throw new DomainError<ArchiveError>('PRODUCT_HAS_STOCK')

      const inDraft = await trx
        .from('stock_draft_items')
        .join('stock_drafts', 'stock_drafts.id', 'stock_draft_items.stock_draft_id')
        .where('stock_draft_items.product_id', productId)
        .where('stock_drafts.status', 'open')
        .select('stock_draft_items.id')
        .first()
      if (inDraft) throw new DomainError<ArchiveError>('PRODUCT_IN_OPEN_DRAFT')

      product.archivedAt = DateTime.now()
      await product.useTransaction(trx).save()
      await AuditService.log(
        actorId,
        'product.archived',
        'product',
        product.id,
        null,
        { name: product.displayName },
        { client: trx }
      )
      return product
    })
  }

  /** Bring an archived product back. Allowed any time; idempotent. */
  async unarchive(actorId: number, productId: number): Promise<Product> {
    return db.transaction(async (trx) => {
      const product = await Product.query({ client: trx })
        .where('id', productId)
        .forUpdate()
        .first()
      if (!product) throw new DomainError<ArchiveError>('PRODUCT_NOT_FOUND')
      if (!product.archivedAt) return product
      await ProductService.unarchiveForStock(product.id, actorId, trx, 'manual')
      await product.refresh()
      return product
    })
  }

  /**
   * Stocking an archived product brings it back (`DeliveryService.addStock` calls this in
   * its transaction), so a new delivery never sits in the fridge invisible to the shop.
   * Does nothing for a product that is not archived.
   */
  static async unarchiveForStock(
    productId: number,
    actorId: number,
    trx: TransactionClientContract,
    reason: 'stocked' | 'manual' = 'stocked'
  ): Promise<void> {
    const restored = await trx
      .from('products')
      .where('id', productId)
      .whereNotNull('archived_at')
      .update({ archived_at: null, updated_at: new Date() })
      .returning(['id', 'display_name'])
    const row = restored[0] as { id: number; display_name: string } | undefined
    if (!row) return
    await AuditService.log(
      actorId,
      'product.unarchived',
      'product',
      row.id,
      null,
      { name: row.display_name, reason },
      { client: trx }
    )
  }

  /**
   * Create a new product. The image and the description are optional — the shop shows a
   * placeholder in the category colour until a photo is added.
   */
  async createProduct(data: {
    displayName: string
    description?: string | null
    categoryId: number
    barcode?: string | null
    image?: MultipartFile | null
    allergenIds?: number[]
    productGroupId?: number | null
  }): Promise<Product> {
    // Save the upload before opening the transaction — it is slow I/O and would hold the
    // keypad-id lock for its duration.
    const imagePath = data.image ? await this.saveImage(data.image) : null

    return withProductKeypadId(async (trx, nextKeypadId) => {
      const product = await Product.create(
        {
          keypadId: nextKeypadId,
          displayName: data.displayName,
          description: data.description ?? '',
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
      description?: string | null
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
    product.description = data.description ?? ''
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
    filters?: {
      search?: string
      categoryId?: number
      sortBy?: string
      sortOrder?: string
      /** 'active' (default) hides archived products, 'archived' lists only them. */
      status?: ProductStatusFilter
      /** Only products still waiting for a photo. */
      missingPhoto?: boolean
    }
  ) {
    const { sortBy, sortOrder } = ProductService.productSort(filters)
    const query = Product.query().preload('category').preload('allergens').preload('productGroup')

    if (sortBy === 'category') {
      // Products without a category sort last either way.
      query
        .leftJoin('categories', 'categories.id', 'products.category_id')
        .select('products.*')
        .orderByRaw(`categories.name ${sortOrder} NULLS LAST`)
    } else {
      query.orderBy(`products.${sortBy === 'keypadId' ? 'keypad_id' : 'display_name'}`, sortOrder)
    }
    // A stable tie-breaker, so paging never shows a product twice or skips one.
    query.orderBy('products.id', 'asc')

    // Every word has to match somewhere: "cola zero" finds "Coca-Cola Zero", in any order.
    // A whole number also matches the kiosk code exactly ("12" finds the product on key 12,
    // not 112 or 120 — barcodes still match as a fragment).
    for (const token of ProductService.searchTokens(filters?.search)) {
      const term = `%${token}%`
      const keypadId = /^\d{1,9}$/.test(token) ? Number(token) : null
      query.where((q) => {
        q.whereRaw('products.display_name ILIKE ?', [term]).orWhereRaw('products.barcode ILIKE ?', [
          term,
        ])
        if (keypadId !== null) q.orWhere('products.keypad_id', keypadId)
      })
    }

    if (filters?.categoryId) {
      query.where('products.category_id', filters.categoryId)
    }

    const status = filters?.status ?? 'active'
    if (status === 'active') query.whereNull('products.archived_at')
    if (status === 'archived') query.whereNotNull('products.archived_at')
    if (filters?.missingPhoto) {
      // The legacy placeholders count as "no photo" too (normalizeImagePath drops them).
      query.where((q) => {
        q.whereNull('products.image_path').orWhereIn('products.image_path', [
          'preview.png',
          '/images/default-product.png',
        ])
      })
    }

    return query.paginate(page, perPage)
  }

  /** Whitelisted sort for the product list; the default is name A→Z. */
  static productSort(filters?: { sortBy?: string; sortOrder?: string }): {
    sortBy: 'displayName' | 'keypadId' | 'category'
    sortOrder: 'asc' | 'desc'
  } {
    const whitelist = ['displayName', 'keypadId', 'category'] as const
    const sortBy = whitelist.find((field) => field === filters?.sortBy) ?? 'displayName'
    const sortOrder = filters?.sortOrder === 'desc' ? 'desc' : 'asc'
    return { sortBy, sortOrder }
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
