import type { HttpContext } from '@adonisjs/core/http'
import OrderService from '#services/order_service'
import NotificationService from '#services/notification_service'
import { apiOrderValidator } from '#validators/order'
import logger from '@adonisjs/core/services/logger'

export default class OrdersController {
  /**
   * @summary Create an order (purchase a product)
   * @description Purchases a product by delivery ID. Optionally specify a channel (e.g. "api", "kiosk").
   * @tag Orders
   * @requestBody {"deliveryId": 3, "channel": "api"}
   * @responseBody 201 - {"data": {"id": 42, "userId": 1, "deliveryId": 3, "price": 25, "channel": "api", "createdAt": "2024-01-01T12:00:00.000Z"}}
   * @responseBody 401 - {"error": "Unauthorized"}
   * @responseBody 409 - {"error": "Product is out of stock."}
   * @responseBody 500 - {"error": "Order creation failed."}
   */
  async store({ request, auth, response }: HttpContext) {
    const { deliveryId, channel } = await request.validateUsing(apiOrderValidator)
    const orderService = new OrderService()

    try {
      const order = await orderService.purchase(auth.user!.id, deliveryId, channel)

      // Send email notification (fire-and-forget)
      const notificationService = new NotificationService()
      notificationService.sendPurchaseConfirmation(order).catch((err) => {
        logger.error({ err }, 'Failed to send purchase confirmation email')
      })

      return response.created({ data: order.serialize() })
    } catch (error) {
      if (error instanceof Error && error.message === 'OUT_OF_STOCK') {
        return response.conflict({ error: 'Product is out of stock.' })
      }
      return response.internalServerError({ error: 'Order creation failed.' })
    }
  }

  /**
   * @summary List recent orders
   * @description Returns the 10 most recent orders for the authenticated user.
   * @tag Orders
   * @responseBody 200 - {"data": [{"id": 42, "userId": 1, "deliveryId": 3, "price": 25, "channel": "api", "createdAt": "2024-01-01T12:00:00.000Z"}]}
   * @responseBody 401 - {"error": "Unauthorized"}
   */
  async latest({ auth, response }: HttpContext) {
    const orderService = new OrderService()
    const { orders } = await orderService.getOrdersForUser(auth.user!.id, 1, 10)
    return response.json({ data: orders.serialize() })
  }
}
