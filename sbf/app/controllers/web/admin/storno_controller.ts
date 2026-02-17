import type { HttpContext } from '@adonisjs/core/http'
import AdminService from '#services/admin_service'

export default class StornoController {
  async store({ params, response, session, i18n }: HttpContext) {
    const service = new AdminService()

    try {
      await service.stornoOrder(params.id)
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
