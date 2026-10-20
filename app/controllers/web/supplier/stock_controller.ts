import type { HttpContext } from '@adonisjs/core/http'
import { resolvePage } from '#helpers/pagination'
import { positiveInt } from '#helpers/query_params'
import DeliveryService, {
  type RepriceErrorCode,
  type StockScope,
  type StockState,
} from '#services/delivery_service'
import FinanceService from '#services/finance_service'
import StockDraftService from '#services/shopping/stock_draft_service'
import Category from '#models/category'
import { isDomainError } from '#services/domain_error'
import { DELIVERY_MAX_PRICE, repriceLotsValidator } from '#validators/delivery'

const REPRICE_ERROR_MESSAGES: Record<RepriceErrorCode, string> = {
  NOTHING_IN_STOCK: 'messages.stock_reprice_lot_empty',
  NO_CHANGE: 'messages.stock_reprice_no_change',
  DELIVERY_NOT_FOUND: 'messages.delivery_correction_not_found',
  DELIVERY_VOIDED: 'messages.delivery_correction_voided',
  FORBIDDEN: 'messages.stock_reprice_forbidden',
  INVALID_PRICE: 'messages.stock_reprice_invalid',
  DUPLICATE_LOT: 'messages.stock_reprice_invalid',
}

/** Sklad › Stav: what is in the fridge, product by product. Stocking happens on a draft. */
export default class StockController {
  async index({ inertia, auth, request }: HttpContext) {
    const service = new DeliveryService()
    const page = resolvePage(request.input('page', 1))
    const categoryId = positiveInt(request.input('categoryId'))
    const sortBy: string = request.input('sortBy') || 'productName'
    const sortOrder: string = request.input('sortOrder') === 'desc' ? 'desc' : 'asc'
    const scope: StockScope = request.input('scope') === 'mine' ? 'mine' : 'all'
    const stateInput = request.input('stockState')
    const stockState: StockState = stateInput === 'low' || stateInput === 'out' ? stateInput : 'all'

    const user = auth.user!
    const [stock, categories, openDraft, incomeLimit] = await Promise.all([
      service.getStockForSupplier(user.id, page, 20, {
        categoryId,
        sortBy,
        sortOrder,
        scope,
        stockState,
        viewerIsAdmin: user.isAdmin,
      }),
      Category.query().where('isDisabled', false).orderBy('name', 'asc'),
      new StockDraftService().openSummary(user.id),
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
      /** The one open draft with lines, for the chip beside "Naskladnit". */
      openDraft,
      incomeLimit,
    })
  }

  /**
   * The lots of a product with pieces left, for the "Změnit cenu" and "Odepsat" dialogs —
   * loaded when one opens, as JSON. FIFO order; no purchase prices.
   */
  async lots({ params, response, auth }: HttpContext) {
    return response.ok({
      lots: await new DeliveryService().listLotsInStock(auth.user!, Number(params.productId)),
    })
  }

  /**
   * "Změnit cenu": new selling prices for chosen lots with pieces left — the supplier's own,
   * anyone's for an admin. Sold pieces keep their price.
   */
  async reprice(ctx: HttpContext) {
    const { request, response, auth, session, i18n } = ctx
    const { items } = await request.validateUsing(repriceLotsValidator)

    try {
      const result = await new DeliveryService().repriceLots(auth.user!, items, {
        impersonatorId: ctx.impersonator?.id,
      })
      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.stock_repriced_lots', {
          lots: result.lots.length,
          count: result.pieces,
        }),
      })
    } catch (error) {
      if (!isDomainError<RepriceErrorCode>(error) || !REPRICE_ERROR_MESSAGES[error.code]) {
        throw error
      }
      session.flash('alert', {
        type: 'danger',
        message: i18n.t(REPRICE_ERROR_MESSAGES[error.code], { max: DELIVERY_MAX_PRICE }),
      })
    }

    return response.redirect('back', true)
  }
}
