import type { HttpContext } from '@adonisjs/core/http'
import OrderService, { PriceChangedError } from '#services/order_service'
import NotificationService from '#services/notification_service'
import { apiOrderValidator } from '#validators/order'
import logger from '@adonisjs/core/services/logger'
import { serializeOrder, serializeOrderWithDelivery } from '#helpers/api_serializers'
import type { OrderCreatedResponse, OrderListResponse } from '#interfaces/api_responses'

export default class OrdersController {
  /**
   * @store
   * @summary Create an order (purchase a product)
   * @description Purchases one unit of the product the delivery ID belongs to. Stock is sold strictly first-in-first-out: the unit always comes from the oldest in-stock lot. If that lot has a different price than the requested one, nothing is bought and 409 is returned. Optionally specify a channel (e.g. "kiosk", "scanner").
   * @tag Orders
   * @requestBody <OrderCreateRequest>
   * @responseBody 201 - <OrderCreatedResponse>
   * @responseBody 401 - <ApiErrorResponse>
   * @responseBody 409 - <ApiErrorResponse>
   * @responseBody 500 - <ApiErrorResponse>
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

      const payload: OrderCreatedResponse = { data: serializeOrder(order) }
      return response.created(payload)
    } catch (error) {
      if (error instanceof PriceChangedError) {
        // Strict FIFO sells the oldest lot; it is not the one requested and costs differently.
        return response.conflict({
          error: `The delivery lot sold next has a different price (${error.price}). Fetch the product again and retry with its current deliveryId.`,
        })
      }
      if (error instanceof Error && error.message === 'OUT_OF_STOCK') {
        return response.conflict({ error: 'Product is out of stock.' })
      }
      return response.internalServerError({ error: 'Order creation failed.' })
    }
  }

  /**
   * @latest
   * @summary List recent orders
   * @description Returns the 10 most recent orders for the authenticated user, including the purchased delivery lot with its product and supplier.
   * @tag Orders
   * @responseBody 200 - <OrderListResponse>
   * @responseBody 401 - <ApiErrorResponse>
   */
  async latest({ auth, response }: HttpContext) {
    const orderService = new OrderService()
    const { orders } = await orderService.getOrdersForUser(auth.user!.id, 1, 10)

    const payload: OrderListResponse = {
      data: {
        meta: {
          total: orders.total,
          perPage: orders.perPage,
          currentPage: orders.currentPage,
          lastPage: orders.lastPage,
        },
        data: orders.all().map((order) => serializeOrderWithDelivery(order)),
      },
    }
    return response.json(payload)
  }
}
