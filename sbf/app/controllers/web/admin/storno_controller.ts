import type { HttpContext } from '@adonisjs/core/http'
import AdminService from '#services/admin_service'
import AuditService from '#services/audit_service'
import NotificationService from '#services/notification_service'
import Order from '#models/order'
import logger from '@adonisjs/core/services/logger'

export default class StornoController {
  async store({ params, response, session, i18n, auth }: HttpContext) {
    const service = new AdminService()

    try {
      // Preload relations before storno — order is deleted inside the transaction
      const order = await Order.query()
        .where('id', params.id)
        .preload('buyer')
        .preload('delivery', (q) => {
          q.preload('product')
          q.preload('supplier')
        })
        .first()

      await service.stornoOrder(params.id)

      AuditService.log(
        auth.user!.id,
        'order.storno',
        'order',
        Number(params.id),
        order?.buyerId ?? null
      )

      // Notify buyer that their order was cancelled (fire-and-forget)
      if (order) {
        const notificationService = new NotificationService()
        notificationService.sendStornoNotification(order).catch((err) => {
          logger.error({ err }, `Failed to send storno email for order #${params.id}`)
        })
      }

      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.storno_success', { id: params.id }),
      })
    } catch (error) {
      const message =
        (error as Error).message === 'ORDER_ALREADY_INVOICED'
          ? i18n.t('messages.storno_already_invoiced')
          : i18n.t('messages.storno_failed')
      session.flash('alert', { type: 'danger', message })
    }

    return response.redirect('/admin/orders')
  }
}
