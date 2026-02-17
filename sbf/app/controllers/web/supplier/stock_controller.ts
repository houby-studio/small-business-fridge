import type { HttpContext } from '@adonisjs/core/http'

export default class StockController {
  async index({ inertia }: HttpContext) {
    // TODO: Phase 5 — Stock overview with remaining amounts
    return inertia.render('supplier/stock/index', { deliveries: [] })
  }
}
