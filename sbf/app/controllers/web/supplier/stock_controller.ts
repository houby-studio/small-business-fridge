import type { HttpContext } from '@adonisjs/core/http'
import DeliveryService from '#services/delivery_service'
import Category from '#models/category'

export default class StockController {
  async index({ inertia, auth, request }: HttpContext) {
    const service = new DeliveryService()
    const page = Number(request.input('page', 1))
    const name = request.input('name') || undefined
    const categoryId = request.input('categoryId') ? Number(request.input('categoryId')) : undefined
    const inStock = request.input('inStock') === '1'
    const sortBy = request.input('sortBy') || undefined
    const sortOrder = request.input('sortOrder') || undefined

    const [stock, categories] = await Promise.all([
      service.getStockForSupplier(auth.user!.id, page, 20, {
        name,
        categoryId,
        inStock,
        sortBy,
        sortOrder,
      }),
      Category.query().where('isDisabled', false).orderBy('name', 'asc'),
    ])

    return inertia.render('supplier/stock/index', {
      stock,
      categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
      filters: {
        name: name ?? '',
        categoryId: categoryId ? String(categoryId) : '',
        inStock: inStock ? '1' : '',
        sortBy: sortBy ?? '',
        sortOrder: sortOrder ?? '',
      },
    })
  }
}
