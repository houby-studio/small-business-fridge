import type { HttpContext } from '@adonisjs/core/http'
import { resolvePage } from '#helpers/pagination'
import AdminService from '#services/admin_service'
import db from '@adonisjs/lucid/services/db'
import InvoiceService, { issuerIsGone, type InvoiceErrorCode } from '#services/invoice_service'
import { paymentActionValidator } from '#validators/invoice'
import { listRedirectUrl } from '#helpers/list_redirect'
import { isDomainError } from '#services/domain_error'

export default class InvoicesController {
  async index({ inertia, request }: HttpContext) {
    const page = resolvePage(request.input('page', 1))
    const status = request.input('status')
    const buyerId = request.input('buyerId')
    const supplierId = request.input('supplierId')
    const sortBy = request.input('sortBy')
    const sortOrder = request.input('sortOrder')

    const service = new AdminService()
    const [invoices, buyers, suppliers] = await Promise.all([
      service.getAllInvoices(page, 20, {
        status: status || undefined,
        buyerId: buyerId ? Number(buyerId) : undefined,
        supplierId: supplierId ? Number(supplierId) : undefined,
        sortBy: sortBy || undefined,
        sortOrder: sortOrder || undefined,
      }),
      db
        .from('users')
        .join('invoices', 'invoices.buyer_id', 'users.id')
        .distinct('users.id', 'users.display_name')
        .orderBy('users.display_name', 'asc'),
      db
        .from('users')
        .join('invoices', 'invoices.supplier_id', 'users.id')
        .distinct('users.id', 'users.display_name')
        .orderBy('users.display_name', 'asc'),
    ])

    return inertia.render('admin/invoices/index', {
      invoices: {
        ...invoices.serialize(),
        // An admin settles the payments of an issuer who left — nobody else can any more.
        data: invoices.all().map((invoice) => ({
          ...invoice.serialize(),
          canSettle: !invoice.isPaid && issuerIsGone(invoice.supplier),
        })),
      },
      filters: {
        status: status || '',
        buyerId: buyerId || '',
        supplierId: supplierId || '',
        sortBy: sortBy || '',
        sortOrder: sortOrder || '',
      },
      buyers: buyers.map((u) => ({ id: Number(u.id), displayName: String(u.display_name) })),
      suppliers: suppliers.map((u) => ({ id: Number(u.id), displayName: String(u.display_name) })),
    })
  }

  /** Confirm or reject a payment for an invoice whose issuer was disabled or left the role. */
  async settlePayment({ params, request, response, session, i18n, auth }: HttpContext) {
    const { action } = await request.validateUsing(paymentActionValidator)
    const service = new InvoiceService()
    try {
      if (action === 'approve') {
        await service.approvePayment(Number(params.id), auth.user!.id, { asAdmin: true })
        session.flash('alert', { type: 'success', message: i18n.t('messages.payment_approved') })
      } else {
        await service.rejectPayment(Number(params.id), auth.user!.id, { asAdmin: true })
        session.flash('alert', { type: 'success', message: i18n.t('messages.payment_rejected') })
      }
    } catch (error) {
      if (!isDomainError<InvoiceErrorCode>(error, 'ISSUER_ACTIVE')) throw error
      session.flash('alert', {
        type: 'danger',
        message: i18n.t('messages.payment_settle_not_allowed'),
      })
    }
    return response.redirect(listRedirectUrl(request, '/admin/invoices'))
  }
}
