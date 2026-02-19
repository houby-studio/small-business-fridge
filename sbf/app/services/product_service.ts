import Product from '#models/product'
import Category from '#models/category'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import app from '@adonisjs/core/services/app'
import { cuid } from '@adonisjs/core/helpers'

export default class ProductService {
  /**
   * Create a new product with optional image upload.
   */
  async createProduct(data: {
    displayName: string
    description: string
    categoryId: number
    barcode?: string | null
    image?: MultipartFile | null
  }): Promise<Product> {
    // Auto-assign next keypad ID
    const maxKeypad = await Product.query().max('keypad_id as max').first()
    const nextKeypadId = (maxKeypad?.$extras.max ?? 0) + 1

    let imagePath: string | null = null
    if (data.image) {
      imagePath = await this.saveImage(data.image)
    }

    return Product.create({
      keypadId: nextKeypadId,
      displayName: data.displayName,
      description: data.description,
      imagePath,
      categoryId: data.categoryId,
      barcode: data.barcode || null,
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
    }
  ): Promise<Product> {
    const product = await Product.findOrFail(productId)

    product.displayName = data.displayName
    product.description = data.description
    product.categoryId = data.categoryId
    product.barcode = data.barcode || null

    if (data.image) {
      product.imagePath = await this.saveImage(data.image)
    }

    await product.save()
    return product
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
    const query = Product.query().preload('category').orderBy('displayName', 'asc')

    if (filters?.search) {
      const term = `%${filters.search}%`
      query.where((q) => {
        q.whereRaw('display_name ILIKE ?', [term]).orWhereRaw('barcode ILIKE ?', [term])
      })
    }

    if (filters?.categoryId) {
      query.where('categoryId', filters.categoryId)
    }

    return query.paginate(page, perPage)
  }

  /**
   * Get a product by ID with relationships.
   */
  async getProduct(productId: number) {
    return Product.query().where('id', productId).preload('category').firstOrFail()
  }

  /**
   * Get all active categories for form dropdowns.
   */
  async getCategories() {
    return Category.query().where('isDisabled', false).orderBy('name', 'asc')
  }

  /**
   * Save uploaded image to storage and return its path.
   */
  private async saveImage(file: MultipartFile): Promise<string> {
    const fileName = `${cuid()}.${file.extname}`
    await file.move(app.makePath('storage/uploads/products'), {
      name: fileName,
    })
    return `/uploads/products/${fileName}`
  }
}
