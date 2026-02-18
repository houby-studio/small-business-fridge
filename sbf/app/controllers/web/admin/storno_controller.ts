import type { HttpContext } from '@adonisjs/core/http'
import AdminService from '#services/admin_service'
import AuditService from '#services/audit_service'
import Order from '#models/order'

export default class StornoController {
  async store({ params, response, session, i18n, auth }: HttpContext) {
    const service = new AdminService()

    try {
      const order = await Order.find(params.id)
      await service.stornoOrder(params.id)

      AuditService.log(auth.user!.id, 'order.storno', 'order', Number(params.id), order?.buyerId ?? null)

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
