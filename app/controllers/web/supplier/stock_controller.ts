import type { HttpContext } from '@adonisjs/core/http'
import DeliveryService from '#services/delivery_service'
import Category from '#models/category'

export default class StockController {
  async index({ inertia, auth, request }: HttpContext) {
    const service = new DeliveryService()
    const page = Number(request.input('page', 1))
    const categoryId = request.input('categoryId') ? Number(request.input('categoryId')) : undefined
    const sortBy = request.input('sortBy') || undefined
    const sortOrder = request.input('sortOrder') || undefined
    const scopeInput = request.input('scope')
    const scope: 'store' | 'mine' = scopeInput === 'mine' ? 'mine' : 'store'
    const preselect = request.input('preselect')

    const [stock, categories, products, recentDeliveries] = await Promise.all([
      service.getStockForSupplier(auth.user!.id, page, 20, {
        categoryId,
        sortBy,
        sortOrder,
        scope,
      }),
      Category.query().where('isDisabled', false).orderBy('name', 'asc'),
      service.getAllProducts(),
      service.getRecentDeliveriesFeed(auth.user!.id, 8, scope),
    ])

    return inertia.render('supplier/stock/index', {
      stock,
      recentDeliveries: recentDeliveries.map((d) => ({
        id: d.id,
        createdAt: d.createdAt.toISO(),
        amountSupplied: d.amountSupplied,
        amountLeft: d.amountLeft,
        price: d.price,
        productName: d.product?.displayName ?? '—',
        supplierName: d.supplier?.displayName ?? '—',
      })),
      categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
      products: products.map((p) => ({ id: p.id, displayName: p.displayName })),
      filters: {
        categoryId: categoryId ? String(categoryId) : '',
        sortBy: sortBy ?? '',
        sortOrder: sortOrder ?? '',
        scope,
      },
      preselect: preselect ? Number(preselect) : null,
    })
  }
}
