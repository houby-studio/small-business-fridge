import type { HttpContext } from '@adonisjs/core/http'
import OrderService from '#services/order_service'

export default class OrdersController {
  async index({ inertia, auth, request }: HttpContext) {
    const orderService = new OrderService()
    const page = request.input('page', 1)

    const { orders, stats } = await orderService.getOrdersForUser(auth.user!.id, page)

    return inertia.render('orders/index', {
      orders: orders.serialize(),
      stats,
    })
  }
}
