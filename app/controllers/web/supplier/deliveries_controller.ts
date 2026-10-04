import type { HttpContext } from '@adonisjs/core/http'
import { resolvePage } from '#helpers/pagination'
import { listRedirectUrl } from '#helpers/list_redirect'
import DeliveryService, { type StockScope } from '#services/delivery_service'
import type { DeliveryCorrectionErrorCode } from '#services/delivery_service'
import StockHistoryService from '#services/stock_history_service'
import NotificationService from '#services/notification_service'
import { isDomainError } from '#services/domain_error'
import { correctDeliveryValidator, voidDeliveryValidator } from '#validators/delivery'
import { normalizeImagePath } from '#helpers/image_url'
import logger from '@adonisjs/core/services/logger'
import type DeliveryCorrection from '#models/delivery_correction'

const CORRECTION_ERROR_MESSAGES: Record<DeliveryCorrectionErrorCode, string> = {
  DELIVERY_NOT_FOUND: 'messages.delivery_correction_not_found',
  FORBIDDEN: 'messages.delivery_correction_forbidden',
  DELIVERY_VOIDED: 'messages.delivery_correction_voided',
  AMOUNT_BELOW_SOLD: 'messages.delivery_correction_amount_below_sold',
  AMOUNT_INCREASE_NOT_ALLOWED: 'messages.delivery_correction_amount_increase',
  NO_CHANGE: 'messages.delivery_correction_no_change',
  DELIVERY_HAS_ORDERS: 'messages.delivery_void_has_orders',
}

type HistoryType = 'deliveries' | 'adjustments'

const PER_PAGE = 20

/**
 * Sklad › Historie: deliveries (with their corrections) or write-offs and inventory
 * differences. Only the table that is shown is loaded; the other comes back empty.
 */
export default class DeliveriesController {
  async index({ inertia, auth, request }: HttpContext) {
    const service = new DeliveryService()
    const user = auth.user!
    const page = resolvePage(request.input('page', 1))
    const productId = request.input('productId')
    const sortBy = request.input('sortBy')
    const sortOrder = request.input('sortOrder')
    const scope: StockScope = request.input('scope') === 'all' ? 'all' : 'mine'
    const type: HistoryType = request.input('type') === 'adjustments' ? 'adjustments' : 'deliveries'
    const listFilters = {
      productId: productId ? Number(productId) : undefined,
      sortBy: sortBy || undefined,
      sortOrder: sortOrder || undefined,
      scope,
    }
    const empty = { data: [], meta: { total: 0, perPage: PER_PAGE, currentPage: 1, lastPage: 1 } }

    const [products, recentDeliveries, adjustments] = await Promise.all([
      service.getAllProducts(),
      type === 'deliveries'
        ? service.getRecentDeliveries(user.id, page, PER_PAGE, listFilters)
        : null,
      type === 'adjustments'
        ? new StockHistoryService().listAdjustments(user.id, page, PER_PAGE, listFilters)
        : empty,
    ])

    const orderStats = await service.getOrderStatsForDeliveries(
      recentDeliveries?.all().map((d) => d.id) ?? []
    )

    return inertia.render('supplier/deliveries/index', {
      products: products.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        imagePath: normalizeImagePath(p.imagePath),
        category: p.category ? { name: p.category.name, color: p.category.color } : null,
      })),
      recentDeliveries: recentDeliveries
        ? {
            meta: recentDeliveries.serialize().meta,
            data: recentDeliveries.all().map((d) => {
              const stats = orderStats.get(d.id)
              const lastCorrection = d.corrections[0]
              return {
                id: d.id,
                createdAt: d.createdAt.toISO(),
                amountSupplied: d.amountSupplied,
                amountLeft: d.amountLeft,
                price: d.price,
                purchasePrice: d.purchasePrice,
                lostCount: d.amountLost,
                voidedAt: d.voidedAt?.toISO() ?? null,
                product: {
                  displayName: d.product?.displayName ?? '—',
                  category: d.product?.category ? { name: d.product.category.name } : undefined,
                },
                supplierName: d.supplier?.displayName ?? '—',
                // What is gone from the lot: sold, plus written off — a correction may not go below it.
                soldCount: d.amountSupplied - d.amountLeft,
                invoicedCount: stats?.invoicedCount ?? 0,
                uninvoicedCount: stats?.uninvoicedCount ?? 0,
                uninvoicedBuyerCount: stats?.uninvoicedBuyerCount ?? 0,
                correctionCount: d.corrections.length,
                lastCorrection: lastCorrection
                  ? { reason: lastCorrection.reason, createdAt: lastCorrection.createdAt.toISO() }
                  : null,
                canCorrect: user.isAdmin || d.supplierId === user.id,
              }
            }),
          }
        : empty,
      adjustments,
      filters: {
        productId: productId || '',
        sortBy: sortBy || '',
        sortOrder: sortOrder || '',
        scope,
        type,
      },
    })
  }

  async update(ctx: HttpContext) {
    const { params, request, response, auth, session, i18n } = ctx
    const data = await request.validateUsing(correctDeliveryValidator)

    try {
      const { delivery, correction, repricedOrderIds } =
        await new DeliveryService().correctDelivery(auth.user!, Number(params.id), data, {
          impersonatorId: ctx.impersonator?.id,
        })

      const notifications = new NotificationService()
      if (correction.repricedOrderCount > 0) {
        notifications
          .sendPriceCorrectionNotifications(correction.id, repricedOrderIds)
          .catch((err) => {
            logger.error({ err }, `Failed to send price correction emails for #${correction.id}`)
          })
      }
      this.notifySupplierOfForeignChange(notifications, delivery.supplierId, correction)

      session.flash('alert', {
        type: 'success',
        message:
          correction.repricedOrderCount > 0
            ? i18n.t('messages.delivery_corrected_repriced', {
                count: correction.repricedOrderCount,
              })
            : i18n.t('messages.delivery_corrected'),
      })
    } catch (error) {
      this.flashCorrectionError(error, session, i18n)
    }

    return response.redirect(listRedirectUrl(request, '/supplier/deliveries'))
  }

  async destroy(ctx: HttpContext) {
    const { params, request, response, auth, session, i18n } = ctx
    const data = await request.validateUsing(voidDeliveryValidator)

    try {
      const { delivery, correction } = await new DeliveryService().voidDelivery(
        auth.user!,
        Number(params.id),
        data.reason,
        { impersonatorId: ctx.impersonator?.id }
      )
      this.notifySupplierOfForeignChange(new NotificationService(), delivery.supplierId, correction)
      session.flash('alert', { type: 'success', message: i18n.t('messages.delivery_voided') })
    } catch (error) {
      this.flashCorrectionError(error, session, i18n)
    }

    return response.redirect(listRedirectUrl(request, '/supplier/deliveries'))
  }

  /** An admin (not the supplier) changed the delivery — let the supplier know. */
  private notifySupplierOfForeignChange(
    notifications: NotificationService,
    supplierId: number,
    correction: DeliveryCorrection
  ) {
    // Their own change — unless an admin made it while impersonating them.
    if (correction.actorId === supplierId && !correction.impersonatorId) return
    notifications.sendDeliveryCorrectionToSupplier(correction.id).catch((err) => {
      logger.error({ err }, `Failed to notify supplier about correction #${correction.id}`)
    })
  }

  private flashCorrectionError(
    error: unknown,
    session: HttpContext['session'],
    i18n: HttpContext['i18n']
  ) {
    if (!isDomainError<DeliveryCorrectionErrorCode>(error)) throw error
    const key = CORRECTION_ERROR_MESSAGES[error.code]
    if (!key) throw error
    session.flash('alert', { type: 'danger', message: i18n.t(key) })
  }
}
