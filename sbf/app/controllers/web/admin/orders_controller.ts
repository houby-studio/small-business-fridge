import type { HttpContext } from '@adonisjs/core/http'

export default class OrdersController {
  async index({ inertia }: HttpContext) {
    // TODO: Phase 6 — All orders overview
    return inertia.render('admin/orders/index', { orders: [] })
  }
}
