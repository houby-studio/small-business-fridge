import type { HttpContext } from '@adonisjs/core/http'
import InvoiceService from '#services/invoice_service'
import NotificationService from '#services/notification_service'
import logger from '@adonisjs/core/services/logger'

export default class InvoiceController {
  async index({ inertia, auth }: HttpContext) {
    const invoiceService = new InvoiceService()
    const uninvoiced = await invoiceService.getUninvoicedSummary(auth.user!.id)

    return inertia.render('supplier/invoice/index', { uninvoiced })
  }

  async generate({ auth, response, session, i18n }: HttpContext) {
    const invoiceService = new InvoiceService()

    const invoices = await invoiceService.generateInvoices(auth.user!.id)

    if (invoices.length === 0) {
      session.flash('alert', { type: 'info', message: i18n.t('messages.invoice_no_orders') })
    } else {
      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.invoice_generated', { count: invoices.length }),
      })

      // Send invoice notifications (fire-and-forget)
      const notificationService = new NotificationService()
      for (const invoice of invoices) {
        notificationService.sendInvoiceNotice(invoice).catch((err) => {
          logger.error({ err }, `Failed to send invoice notice for invoice #${invoice.id}`)
        })
      }
    }

    return response.redirect('/supplier/invoice')
  }
}
