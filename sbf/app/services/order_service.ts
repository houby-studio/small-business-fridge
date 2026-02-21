import Delivery from '#models/delivery'
import Order from '#models/order'
import db from '@adonisjs/lucid/services/db'
import AuditService from '#services/audit_service'

type OrderChannel = 'web' | 'kiosk' | 'scanner'

export class OutOfStockError extends Error {
  constructor(public readonly deliveryId: number) {
    super('OUT_OF_STOCK')
    this.name = 'OutOfStockError'
  }
}

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
   * Atomic basket purchase — validates and buys all items in a single DB transaction.
   * Throws OutOfStockError (with deliveryId) if any item lacks sufficient stock.
   * Creates one Order row per unit to preserve the existing order model.
   */
  async purchaseBasket(
    buyerId: number,
    items: Array<{ deliveryId: number; quantity: number }>,
    channel: OrderChannel
  ): Promise<Order[]> {
    return db.transaction(async (trx) => {
      const orders: Order[] = []

      for (const item of items) {
        // Lock row and validate sufficient stock for full quantity
        const delivery = await Delivery.query({ client: trx })
          .where('id', item.deliveryId)
          .where('amountLeft', '>=', item.quantity)
          .forUpdate()
          .first()

        if (!delivery) {
          throw new OutOfStockError(item.deliveryId)
        }

        // Decrement stock by full quantity at once
        delivery.amountLeft -= item.quantity
        await delivery.save()

        // Create one Order row per unit (preserving existing model)
        for (let q = 0; q < item.quantity; q++) {
          const order = await Order.create(
            { buyerId, deliveryId: item.deliveryId, channel },
            { client: trx }
          )
          orders.push(order)

          AuditService.log(buyerId, 'order.created', 'order', order.id, delivery.supplierId, {
            productId: delivery.productId,
            price: delivery.price,
            channel,
          })
        }
      }

      return orders
    })
  }

  /**
   * Get paginated orders for a specific user with optional channel and invoiced filters.
   */
  async getOrdersForUser(
    userId: number,
    page: number = 1,
    perPage: number = 20,
    filters?: { channel?: string; invoiced?: string; sortBy?: string; sortOrder?: string }
  ) {
    const sortByWhitelist = ['createdAt']
    const sortBy = sortByWhitelist.includes(filters?.sortBy ?? '') ? filters!.sortBy! : 'createdAt'
    const sortOrder = filters?.sortOrder === 'asc' ? 'asc' : 'desc'

    const ordersQuery = Order.query()
      .where('buyerId', userId)
      .preload('delivery', (q) => {
        q.preload('product')
        q.preload('supplier')
      })
      .orderBy(sortBy, sortOrder)

    if (filters?.channel) {
      ordersQuery.where('channel', filters.channel)
    }

    if (filters?.invoiced === 'yes') {
      ordersQuery.whereNotNull('invoiceId')
    } else if (filters?.invoiced === 'no') {
      ordersQuery.whereNull('invoiceId')
    }

    const orders = await ordersQuery.paginate(page, perPage)

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
