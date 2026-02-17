import type { HttpContext } from '@adonisjs/core/http'

export default class OrdersController {
  async index({ inertia }: HttpContext) {
    // TODO: Phase 3 — OrderService.getOrdersForUser()
    return inertia.render('orders/index', { orders: [] })
  }
}
