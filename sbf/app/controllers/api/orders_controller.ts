import type { HttpContext } from '@adonisjs/core/http'
import OrderService from '#services/order_service'
import { apiOrderValidator } from '#validators/order'

export default class OrdersController {
  async store({ request, auth, response }: HttpContext) {
    const { deliveryId, channel } = await request.validateUsing(apiOrderValidator)
    const orderService = new OrderService()

    try {
      const order = await orderService.purchase(auth.user!.id, deliveryId, channel)
      return response.created({ data: order.serialize() })
    } catch (error) {
      if (error instanceof Error && error.message === 'OUT_OF_STOCK') {
        return response.conflict({ error: 'Product is out of stock.' })
      }
      return response.internalServerError({ error: 'Order creation failed.' })
    }
  }

  async latest({ auth, response }: HttpContext) {
    const orderService = new OrderService()
    const { orders } = await orderService.getOrdersForUser(auth.user!.id, 1, 10)
    return response.json({ data: orders.serialize() })
  }
}
