import type { HttpContext } from '@adonisjs/core/http'
import OrderService from '#services/order_service'

export default class OrdersController {
  async index({ inertia, auth, request }: HttpContext) {
    const orderService = new OrderService()
    const page = request.input('page', 1)
    const channel = request.input('channel')
    const invoiced = request.input('invoiced')
    const sortBy = request.input('sortBy')
    const sortOrder = request.input('sortOrder')

    const { orders, stats } = await orderService.getOrdersForUser(auth.user!.id, page, 20, {
      channel: channel || undefined,
      invoiced: invoiced || undefined,
      sortBy: sortBy || undefined,
      sortOrder: sortOrder || undefined,
    })

    return inertia.render('orders/index', {
      orders: orders.serialize(),
      stats,
      filters: {
        channel: channel || '',
        invoiced: invoiced || '',
        sortBy: sortBy || '',
        sortOrder: sortOrder || '',
      },
    })
  }
}
