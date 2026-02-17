import type { HttpContext } from '@adonisjs/core/http'

export default class InvoicesController {
  async index({ inertia }: HttpContext) {
    // TODO: Phase 4 — InvoiceService.getInvoicesForUser()
    return inertia.render('invoices/index', { invoices: [] })
  }

  async requestPaid({ response }: HttpContext) {
    // TODO: Phase 4 — InvoiceService.requestPaid()
    return response.redirect('/invoices')
  }

  async cancelPaid({ response }: HttpContext) {
    // TODO: Phase 4 — InvoiceService.cancelPaid()
    return response.redirect('/invoices')
  }

  async qrcode({ response }: HttpContext) {
    // TODO: Phase 4 — QR code generation
    return response.json({ qrcode: '' })
  }
}
