import type { HttpContext } from '@adonisjs/core/http'

export default class PaymentsController {
  async index({ inertia }: HttpContext) {
    // TODO: Phase 5 — Load invoices with payment requests
    return inertia.render('supplier/payments/index', { invoices: [] })
  }

  async update({ response }: HttpContext) {
    // TODO: Phase 5 — Approve or reject payment
    return response.redirect('/supplier/payments')
  }
}
