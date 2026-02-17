import type { HttpContext } from '@adonisjs/core/http'

export default class InvoiceController {
  async index({ inertia }: HttpContext) {
    // TODO: Phase 5 — Show uninvoiced orders grouped by buyer
    return inertia.render('supplier/invoice/index', { groups: [] })
  }

  async generate({ response }: HttpContext) {
    // TODO: Phase 5 — InvoiceService.generateInvoices()
    return response.redirect('/supplier/invoice')
  }
}
