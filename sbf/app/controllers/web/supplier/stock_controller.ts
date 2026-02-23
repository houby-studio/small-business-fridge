import type { HttpContext } from '@adonisjs/core/http'
import DeliveryService from '#services/delivery_service'
import Category from '#models/category'

export default class StockController {
  async index({ inertia, auth, request }: HttpContext) {
    const service = new DeliveryService()
    const page = Number(request.input('page', 1))
    const productId = request.input('productId') ? Number(request.input('productId')) : undefined
    const categoryId = request.input('categoryId') ? Number(request.input('categoryId')) : undefined
    const inStock = request.input('inStock') === '1'
    const sortBy = request.input('sortBy') || undefined
    const sortOrder = request.input('sortOrder') || undefined

    const [stock, categories, products] = await Promise.all([
      service.getStockForSupplier(auth.user!.id, page, 20, {
        productId,
        categoryId,
        inStock,
        sortBy,
        sortOrder,
      }),
      Category.query().where('isDisabled', false).orderBy('name', 'asc'),
      service.getAllProducts(),
    ])

    return inertia.render('supplier/stock/index', {
      stock,
      categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
      products: products.map((p) => ({ id: p.id, displayName: p.displayName })),
      filters: {
        productId: productId ? String(productId) : '',
        categoryId: categoryId ? String(categoryId) : '',
        inStock: inStock ? '1' : '',
        sortBy: sortBy ?? '',
        sortOrder: sortOrder ?? '',
      },
    })
  }
}
