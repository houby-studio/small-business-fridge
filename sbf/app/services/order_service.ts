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

export class FifoViolationError extends Error {
  constructor(public readonly productId: number) {
    super('FIFO_VIOLATION')
    this.name = 'FifoViolationError'
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

      const requestedByDelivery = new Map<number, number>()
      for (const item of items) {
        requestedByDelivery.set(
          item.deliveryId,
          (requestedByDelivery.get(item.deliveryId) ?? 0) + item.quantity
        )
      }

      const requestedDeliveryIds = [...requestedByDelivery.keys()]
      const requestedDeliveries = await Delivery.query({ client: trx })
        .whereIn('id', requestedDeliveryIds)
        .forUpdate()

      const deliveryMap = new Map(requestedDeliveries.map((d) => [d.id, d]))

      for (const [deliveryId, quantity] of requestedByDelivery) {
        const delivery = deliveryMap.get(deliveryId)
        if (!delivery || delivery.amountLeft < quantity) {
          throw new OutOfStockError(deliveryId)
        }
      }

      const requestedByProduct = new Map<number, Map<number, number>>()
      const totalRequestedByProduct = new Map<number, number>()

      for (const [deliveryId, quantity] of requestedByDelivery) {
        const delivery = deliveryMap.get(deliveryId)!
        const productId = delivery.productId
        const productMap = requestedByProduct.get(productId) ?? new Map<number, number>()
        productMap.set(deliveryId, quantity)
        requestedByProduct.set(productId, productMap)
        totalRequestedByProduct.set(
          productId,
          (totalRequestedByProduct.get(productId) ?? 0) + quantity
        )
      }

      const requestedProductIds = [...requestedByProduct.keys()]
      const fifoDeliveries = await Delivery.query({ client: trx })
        .whereIn('productId', requestedProductIds)
        .where('amountLeft', '>', 0)
        .orderBy('productId', 'asc')
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc')
        .forUpdate()

      const fifoByProduct = new Map<number, Delivery[]>()
      for (const delivery of fifoDeliveries) {
        const productDeliveries = fifoByProduct.get(delivery.productId) ?? []
        productDeliveries.push(delivery)
        fifoByProduct.set(delivery.productId, productDeliveries)
      }

      for (const productId of requestedProductIds) {
        const requestedForProduct = requestedByProduct.get(productId) ?? new Map<number, number>()
        const totalRequested = totalRequestedByProduct.get(productId) ?? 0
        const fifo = fifoByProduct.get(productId) ?? []

        let remaining = totalRequested
        const expectedByDelivery = new Map<number, number>()

        for (const delivery of fifo) {
          if (remaining <= 0) break
          const take = Math.min(delivery.amountLeft, remaining)
          if (take > 0) {
            expectedByDelivery.set(delivery.id, take)
            remaining -= take
          }
        }

        if (remaining > 0) {
          const firstRequestedDeliveryId = requestedForProduct.keys().next().value as number
          throw new OutOfStockError(firstRequestedDeliveryId)
        }

        for (const [deliveryId, quantity] of requestedForProduct) {
          if ((expectedByDelivery.get(deliveryId) ?? 0) !== quantity) {
            throw new FifoViolationError(productId)
          }
        }

        for (const [deliveryId, quantity] of expectedByDelivery) {
          if ((requestedForProduct.get(deliveryId) ?? 0) !== quantity) {
            throw new FifoViolationError(productId)
          }
        }
      }

      for (const [deliveryId, quantity] of requestedByDelivery) {
        const delivery = deliveryMap.get(deliveryId)!

        delivery.amountLeft -= quantity
        await delivery.save()

        for (let q = 0; q < quantity; q++) {
          const order = await Order.create({ buyerId, deliveryId, channel }, { client: trx })
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

    const buildStatsQuery = () =>
      Order.query()
        .where('buyerId', userId)
        .join('deliveries', 'orders.delivery_id', 'deliveries.id')
        .select(
          db.rawQuery('COUNT(*)::int as total_orders'),
          db.rawQuery('COALESCE(SUM(deliveries.price), 0)::numeric as total_spend'),
          db.rawQuery(
            'COALESCE(SUM(CASE WHEN orders.invoice_id IS NULL THEN deliveries.price ELSE 0 END), 0)::numeric as total_uninvoiced'
          )
        )

    const applyFiltersToStatsQuery = (query: ReturnType<typeof buildStatsQuery>) => {
      if (filters?.channel) {
        query.where('channel', filters.channel)
      }

      if (filters?.invoiced === 'yes') {
        query.whereNotNull('invoiceId')
      } else if (filters?.invoiced === 'no') {
        query.whereNull('invoiceId')
      }

      return query
    }

    const totalStats = await buildStatsQuery().first()
    const filtersApplied = Boolean(filters?.channel || filters?.invoiced)
    const filteredStats = filtersApplied
      ? await applyFiltersToStatsQuery(buildStatsQuery()).first()
      : totalStats

    return {
      orders,
      stats: {
        totalOrders: totalStats?.$extras.total_orders ?? 0,
        totalSpend: Number(totalStats?.$extras.total_spend ?? 0),
        totalUninvoiced: Number(totalStats?.$extras.total_uninvoiced ?? 0),
        filteredOrders: filteredStats?.$extras.total_orders ?? 0,
        filteredSpend: Number(filteredStats?.$extras.total_spend ?? 0),
        filteredUninvoiced: Number(filteredStats?.$extras.total_uninvoiced ?? 0),
        filtersApplied,
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
