import type { HttpContext } from '@adonisjs/core/http'
import { resolvePage } from '#helpers/pagination'
import DeliveryService, { type StockScope, type StockState } from '#services/delivery_service'
import FinanceService from '#services/finance_service'
import StockDraftService from '#services/shopping/stock_draft_service'
import Category from '#models/category'

/** Sklad › Stav: what is in the fridge, product by product. Stocking happens on a draft. */
export default class StockController {
  async index({ inertia, auth, request }: HttpContext) {
    const service = new DeliveryService()
    const page = resolvePage(request.input('page', 1))
    const categoryId = request.input('categoryId') ? Number(request.input('categoryId')) : undefined
    const sortBy: string = request.input('sortBy') || 'productName'
    const sortOrder: string = request.input('sortOrder') === 'desc' ? 'desc' : 'asc'
    const scope: StockScope = request.input('scope') === 'mine' ? 'mine' : 'all'
    const stateInput = request.input('stockState')
    const stockState: StockState = stateInput === 'low' || stateInput === 'out' ? stateInput : 'all'

    const user = auth.user!
    const [stock, categories, openDraftCount, incomeLimit] = await Promise.all([
      service.getStockForSupplier(user.id, page, 20, {
        categoryId,
        sortBy,
        sortOrder,
        scope,
        stockState,
      }),
      Category.query().where('isDisabled', false).orderBy('name', 'asc'),
      new StockDraftService().countOpen(user.id),
      new FinanceService().currentLimitStatus(user.id, Number(user.marginPercent ?? 0)),
    ])

    return inertia.render('supplier/stock/index', {
      stock,
      categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
      filters: {
        categoryId: categoryId ? String(categoryId) : '',
        sortBy,
        sortOrder,
        scope,
        stockState,
      },
      openDraftCount,
      incomeLimit,
    })
  }
}
