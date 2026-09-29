import type { HttpContext } from '@adonisjs/core/http'
import { resolvePage } from '#helpers/pagination'
import DeliveryService from '#services/delivery_service'
import type { DeliveryCorrectionErrorCode } from '#services/delivery_service'
import NotificationService from '#services/notification_service'
import { isDomainError } from '#services/domain_error'
import {
  createDeliveryValidator,
  correctDeliveryValidator,
  voidDeliveryValidator,
} from '#validators/delivery'
import { normalizeImagePath } from '#helpers/image_url'
import logger from '@adonisjs/core/services/logger'
import type DeliveryCorrection from '#models/delivery_correction'

function deliveryReturnUrl(request: HttpContext['request']): string {
  const referer = request.header('referer') ?? ''
  try {
    const { pathname, search } = new URL(referer)
    if (pathname === '/supplier/stock' || pathname === '/supplier/deliveries') {
      return pathname + search
    }
  } catch {
    // invalid URL — use fallback
  }
  return '/supplier/deliveries'
}

const CORRECTION_ERROR_MESSAGES: Record<DeliveryCorrectionErrorCode, string> = {
  DELIVERY_NOT_FOUND: 'messages.delivery_correction_not_found',
  FORBIDDEN: 'messages.delivery_correction_forbidden',
  DELIVERY_VOIDED: 'messages.delivery_correction_voided',
  AMOUNT_BELOW_SOLD: 'messages.delivery_correction_amount_below_sold',
  AMOUNT_INCREASE_NOT_ALLOWED: 'messages.delivery_correction_amount_increase',
  NO_CHANGE: 'messages.delivery_correction_no_change',
  DELIVERY_HAS_ORDERS: 'messages.delivery_void_has_orders',
}

export default class DeliveriesController {
  async index({ inertia, auth, request }: HttpContext) {
    const service = new DeliveryService()
    const user = auth.user!
    const page = resolvePage(request.input('page', 1))
    const productId = request.input('productId')
    const sortBy = request.input('sortBy')
    const sortOrder = request.input('sortOrder')
    const scope: 'store' | 'mine' = request.input('scope') === 'store' ? 'store' : 'mine'
    const preselect = request.input('preselect')

    const [products, recentDeliveries] = await Promise.all([
      service.getAllProducts(),
      service.getRecentDeliveries(user.id, page, 20, {
        productId: productId ? Number(productId) : undefined,
        sortBy: sortBy || undefined,
        sortOrder: sortOrder || undefined,
        scope,
      }),
    ])

    const orderStats = await service.getOrderStatsForDeliveries(
      recentDeliveries.all().map((d) => d.id)
    )
    const serialized = recentDeliveries.serialize()

    return inertia.render('supplier/deliveries/index', {
      products: products.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        imagePath: normalizeImagePath(p.imagePath),
        category: p.category ? { name: p.category.name, color: p.category.color } : null,
      })),
      recentDeliveries: {
        meta: serialized.meta,
        data: recentDeliveries.all().map((d) => {
          const stats = orderStats.get(d.id)
          const lastCorrection = d.corrections[0]
          return {
            id: d.id,
            createdAt: d.createdAt.toISO(),
            amountSupplied: d.amountSupplied,
            amountLeft: d.amountLeft,
            price: d.price,
            voidedAt: d.voidedAt?.toISO() ?? null,
            product: {
              displayName: d.product?.displayName ?? '—',
              category: d.product?.category ? { name: d.product.category.name } : undefined,
            },
            supplierName: d.supplier?.displayName ?? '—',
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
      },
      filters: {
        productId: productId || '',
        sortBy: sortBy || '',
        sortOrder: sortOrder || '',
        scope,
      },
      preselect: preselect ? Number(preselect) : null,
    })
  }

  async store({ request, response, auth, session, i18n }: HttpContext) {
    const data = await request.validateUsing(createDeliveryValidator)

    const service = new DeliveryService()

    if (!data.confirmWarnings) {
      const warnings = await service.getStockWarnings(auth.user!.id, data.productId, data.price)
      if (warnings) {
        // Nothing is stored — the page shows a confirm dialog and resubmits with
        // confirmWarnings once the supplier has checked the numbers.
        session.flash('deliveryWarning', {
          ...warnings,
          productId: data.productId,
          amount: data.amount,
          price: data.price,
        })
        return response.redirect(deliveryReturnUrl(request))
      }
    }

    const delivery = await service.addStock(auth.user!.id, data.productId, data.amount, data.price)

    // Notify users who favourited this product (fire-and-forget)
    const notificationService = new NotificationService()
    notificationService.sendRestockNotification(delivery).catch((err) => {
      logger.error({ err }, `Failed to send restock notifications for product #${data.productId}`)
    })

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.delivery_created', { amount: data.amount, price: data.price }),
    })

    return response.redirect(deliveryReturnUrl(request))
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

    return response.redirect(deliveryReturnUrl(request))
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

    return response.redirect(deliveryReturnUrl(request))
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
