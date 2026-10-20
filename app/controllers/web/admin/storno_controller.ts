import type { HttpContext } from '@adonisjs/core/http'
import { listRedirectUrl } from '#helpers/list_redirect'
import AdminService from '#services/admin_service'

export default class StornoController {
  async store({ params, request, response, session, i18n, auth }: HttpContext) {
    const service = new AdminService()

    try {
      // The service e-mails the buyer and the supplier whose stock it came from.
      await service.stornoOrder(params.id, auth.user!.id)

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

    return response.redirect(listRedirectUrl(request, '/admin/orders'))
  }
}
