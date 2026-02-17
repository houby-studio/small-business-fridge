import type { HttpContext } from '@adonisjs/core/http'

export default class DeliveriesController {
  async index({ inertia }: HttpContext) {
    // TODO: Phase 5 — Load products for supplier to add stock
    return inertia.render('supplier/deliveries/index', { products: [] })
  }

  async store({ response }: HttpContext) {
    // TODO: Phase 5 — Create delivery record
    return response.redirect('/supplier/deliveries')
  }
}
