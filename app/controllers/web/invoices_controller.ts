import type { HttpContext } from '@adonisjs/core/http'
import InvoiceService from '#services/invoice_service'
import QrPaymentService from '#services/qr_payment_service'
import NotificationService from '#services/notification_service'
import Invoice from '#models/invoice'
import logger from '@adonisjs/core/services/logger'

export default class InvoicesController {
  async index({ inertia, auth, request }: HttpContext) {
    const invoiceService = new InvoiceService()
    const page = request.input('page', 1)
    const status = request.input('status')
    const sortBy = request.input('sortBy')
    const sortOrder = request.input('sortOrder')
    const confirmIdRaw = request.input('confirmId')

    const invoices = await invoiceService.getInvoicesForBuyer(auth.user!.id, page, 20, {
      status: status || undefined,
      sortBy: sortBy || undefined,
      sortOrder: sortOrder || undefined,
    })

    let confirmInvoice: { id: number; totalCost: number } | null = null
    if (confirmIdRaw) {
      const confirmId = Number(confirmIdRaw)
      if (!Number.isNaN(confirmId) && confirmId > 0) {
        const inv = await Invoice.query()
          .where('id', confirmId)
          .where('buyerId', auth.user!.id)
          .where('isPaid', false)
          .where('isPaymentRequested', false)
          .first()
        if (inv) {
          confirmInvoice = { id: inv.id, totalCost: inv.totalCost }
        }
      }
    }

    return inertia.render('invoices/index', {
      invoices: invoices.serialize(),
      filters: { status: status || '', sortBy: sortBy || '', sortOrder: sortOrder || '' },
      confirmInvoice,
    })
  }

  async requestPaid({ params, auth, response, session, i18n }: HttpContext) {
    const invoiceService = new InvoiceService()

    try {
      const invoice = await invoiceService.requestPayment(Number(params.id), auth.user!.id)
      session.flash('alert', { type: 'success', message: i18n.t('messages.payment_requested') })

      // Notify supplier that customer has sent payment (fire-and-forget)
      const notificationService = new NotificationService()
      notificationService.sendPaymentRequestedNotification(invoice).catch((err) => {
        logger.error({ err }, `Failed to send payment requested email for invoice #${params.id}`)
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'FORBIDDEN') {
        session.flash('alert', { type: 'danger', message: i18n.t('messages.invoice_forbidden') })
      } else if (error instanceof Error && error.message === 'ALREADY_PAID') {
        session.flash('alert', { type: 'info', message: i18n.t('messages.invoice_already_paid') })
      } else {
        session.flash('alert', { type: 'danger', message: i18n.t('messages.action_failed') })
      }
    }

    return response.redirect('/invoices')
  }

  async cancelPaid({ params, auth, response, session, i18n }: HttpContext) {
    const invoiceService = new InvoiceService()

    try {
      const invoice = await invoiceService.cancelPaymentRequest(Number(params.id), auth.user!.id)
      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.payment_request_cancelled'),
      })

      // Notify supplier that buyer withdrew payment confirmation (fire-and-forget)
      const notificationService = new NotificationService()
      notificationService.sendPaymentWithdrawnNotification(invoice).catch((err) => {
        logger.error({ err }, `Failed to send payment withdrawn email for invoice #${params.id}`)
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'FORBIDDEN') {
        session.flash('alert', { type: 'danger', message: i18n.t('messages.invoice_forbidden') })
      } else {
        session.flash('alert', { type: 'danger', message: i18n.t('messages.action_failed') })
      }
    }

    return response.redirect('/invoices')
  }

  async qrcode({ params, auth, response, i18n }: HttpContext) {
    const invoiceService = new InvoiceService()
    const qrService = new QrPaymentService()

    // Load invoice with supplier info
    const invoices = await invoiceService.getInvoicesForBuyer(auth.user!.id, 1, 1000)
    const invoice = invoices.all().find((i) => i.id === Number(params.id))

    if (!invoice) {
      return response.notFound({ error: i18n.t('messages.invoice_not_found') })
    }

    await invoice.load('supplier')

    if (!invoice.supplier.iban) {
      return response.badRequest({ error: i18n.t('messages.supplier_no_iban') })
    }

    const qr = await qrService.generate({
      iban: invoice.supplier.iban,
      amount: invoice.totalCost,
      receiverName: invoice.supplier.displayName,
      payerName: auth.user!.displayName,
    })

    return response.json(qr)
  }
}
