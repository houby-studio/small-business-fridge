import type { HttpContext } from '@adonisjs/core/http'
import InvoiceService from '#services/invoice_service'
import NotificationService from '#services/notification_service'
import { paymentActionValidator } from '#validators/invoice'
import logger from '@adonisjs/core/services/logger'

export default class PaymentsController {
  async index({ inertia, auth, request }: HttpContext) {
    const invoiceService = new InvoiceService()
    const page = request.input('page', 1)
    const status = request.input('status')
    const invoices = await invoiceService.getInvoicesForSupplier(auth.user!.id, page, 20, {
      status: status || undefined,
    })

    return inertia.render('supplier/payments/index', {
      invoices: invoices.serialize(),
      filters: { status: status || '' },
    })
  }

  async update({ params, request, auth, response, session, i18n }: HttpContext) {
    const { action } = await request.validateUsing(paymentActionValidator)
    const invoiceService = new InvoiceService()

    try {
      let invoice
      if (action === 'approve') {
        invoice = await invoiceService.approvePayment(Number(params.id), auth.user!.id)
        session.flash('alert', { type: 'success', message: i18n.t('messages.payment_approved') })
      } else {
        invoice = await invoiceService.rejectPayment(Number(params.id), auth.user!.id)
        session.flash('alert', { type: 'success', message: i18n.t('messages.payment_rejected') })
      }

      // Send payment status notification (fire-and-forget)
      const notificationService = new NotificationService()
      notificationService
        .sendPaymentStatusChange(invoice, action === 'approve' ? 'approved' : 'rejected')
        .catch((err) => {
          logger.error({ err }, `Failed to send payment status email for invoice #${params.id}`)
        })
    } catch (error) {
      if (error instanceof Error && error.message === 'FORBIDDEN') {
        session.flash('alert', { type: 'danger', message: i18n.t('messages.invoice_forbidden') })
      } else {
        session.flash('alert', { type: 'danger', message: i18n.t('messages.action_failed') })
      }
    }

    return response.redirect('/supplier/payments')
  }
}
