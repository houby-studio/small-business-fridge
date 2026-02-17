import type { HttpContext } from '@adonisjs/core/http'

export default class InvoicesController {
  async index({ inertia }: HttpContext) {
    // TODO: Phase 6 — All invoices overview
    return inertia.render('admin/invoices/index', { invoices: [] })
  }
}
