import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import InvoiceService from '#services/invoice_service'

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
    }

    return response.redirect('/supplier/invoice')
  }

  async generateForBuyer({ params, auth, response, session, i18n }: HttpContext) {
    const buyerId = Number(params.buyerId)
    const invoiceService = new InvoiceService()

    const invoice = await invoiceService.generateInvoiceForBuyer(auth.user!.id, buyerId)

    if (invoice === null) {
      session.flash('alert', {
        type: 'info',
        message: i18n.t('messages.invoice_no_orders_for_buyer'),
      })
    } else {
      // The message reads "invoice generated for {name}", so pass the name — not the id.
      const buyer = await User.find(buyerId)
      session.flash('alert', {
        type: 'success',
        message: i18n.t('supplier.invoice_generated_for_buyer', {
          name: buyer?.displayName ?? String(buyerId),
        }),
      })
    }

    return response.redirect('/supplier/invoice')
  }
}
