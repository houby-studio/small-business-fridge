import Delivery from '#models/delivery'
import Order from '#models/order'
import db from '@adonisjs/lucid/services/db'
import AuditService from '#services/audit_service'

type OrderChannel = 'web' | 'keypad' | 'scanner'

export default class OrderService {
  /**
   * Unified purchase logic for ALL channels.
   * Uses a database transaction to ensure stock consistency.
   */
  async purchase(buyerId: number, deliveryId: number, channel: OrderChannel): Promise<Order> {
    return db.transaction(async (trx) => {
      // Lock the delivery row for update to prevent race conditions
      const delivery = await Delivery.query({ client: trx })
        .where('id', deliveryId)
        .where('amountLeft', '>', 0)
        .forUpdate()
        .first()

      if (!delivery) {
        throw new Error('OUT_OF_STOCK')
      }

      // Decrement stock
      delivery.amountLeft -= 1
      await delivery.save()

      // Create order
      const order = await Order.create(
        {
          buyerId,
          deliveryId,
          channel,
        },
        { client: trx }
      )

      // Audit log (fire-and-forget, outside transaction)
      AuditService.log(buyerId, 'order.created', 'order', order.id, delivery.supplierId, {
        productId: delivery.productId,
        price: delivery.price,
        channel,
      })

      return order
    })
  }

  /**
   * Get paginated orders for a specific user.
   */
  async getOrdersForUser(userId: number, page: number = 1, perPage: number = 20) {
    const orders = await Order.query()
      .where('buyerId', userId)
      .preload('delivery', (q) => {
        q.preload('product')
        q.preload('supplier')
      })
      .orderBy('createdAt', 'desc')
      .paginate(page, perPage)

    // Get summary stats
    const stats = await Order.query()
      .where('buyerId', userId)
      .join('deliveries', 'orders.delivery_id', 'deliveries.id')
      .select(
        db.rawQuery('COUNT(*)::int as total_orders'),
        db.rawQuery('COALESCE(SUM(deliveries.price), 0)::numeric as total_spend'),
        db.rawQuery(
          'COALESCE(SUM(CASE WHEN orders.invoice_id IS NULL THEN deliveries.price ELSE 0 END), 0)::numeric as total_unpaid'
        )
      )
      .first()

    return {
      orders,
      stats: {
        totalOrders: stats?.$extras.total_orders ?? 0,
        totalSpend: Number(stats?.$extras.total_spend ?? 0),
        totalUnpaid: Number(stats?.$extras.total_unpaid ?? 0),
      },
    }
  }

  /**
   * Get paginated orders for admin (all orders).
   */
  async getAllOrders(page: number = 1, perPage: number = 20) {
    return Order.query()
      .preload('buyer')
      .preload('delivery', (q) => {
        q.preload('product')
        q.preload('supplier')
      })
      .orderBy('createdAt', 'desc')
      .paginate(page, perPage)
  }
}
