import Delivery from '#models/delivery'
import { PUBLIC_USER_COLUMNS } from '#helpers/public_user'
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

export class PriceChangedError extends Error {
  constructor(
    public readonly deliveryId: number,
    public readonly price: number
  ) {
    super('PRICE_CHANGED')
    this.name = 'PriceChangedError'
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
   * Single-unit purchase for every channel (web shop, kiosk, REST API, MCP).
   *
   * Strict FIFO: the unit always comes from the oldest in-stock delivery of the product,
   * whichever lot the client named — the client only tells us *which product*. Otherwise a
   * client (or a cheaper, newer delivery) could jump the queue while older stock sits
   * unsold and its supplier waits for their money.
   *
   * The buyer confirmed a price. Clients send it as `expectedPrice`; if the lot sold next
   * costs anything else — a stale page, a newer lot, or a price corrected in the meantime —
   * nothing is bought and PriceChangedError carries the current price so the client can
   * ask again. Without `expectedPrice` the requested lot's price stands in for it.
   */
  async purchase(
    buyerId: number,
    deliveryId: number,
    channel: OrderChannel,
    expectedPrice?: number
  ): Promise<Order> {
    return db.transaction(async (trx) => {
      const requested = await Delivery.query({ client: trx }).where('id', deliveryId).first()
      if (!requested) {
        throw new Error('OUT_OF_STOCK')
      }

      // Lock every in-stock lot of the product (as purchaseBasket does) and pick the oldest
      // in JS: FOR UPDATE with LIMIT can come back empty under contention even though a
      // later lot still has stock.
      const lots = await Delivery.query({ client: trx })
        .where('productId', requested.productId)
        .where('amountLeft', '>', 0)
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc')
        .forUpdate()
      const delivery = lots[0]

      if (!delivery) {
        throw new Error('OUT_OF_STOCK')
      }
      // Compare against the price the buyer was shown when the client sends it; otherwise
      // (older clients) at least against the lot they named.
      const shownPrice = expectedPrice ?? requested.price
      if (delivery.price !== shownPrice) {
        throw new PriceChangedError(delivery.id, delivery.price)
      }

      delivery.amountLeft -= 1
      await delivery.save()

      const order = await Order.create(
        {
          buyerId,
          deliveryId: delivery.id,
          channel,
          unitPrice: delivery.price,
        },
        { client: trx }
      )

      await AuditService.log(buyerId, 'order.created', 'order', order.id, delivery.supplierId, {
        productId: delivery.productId,
        price: delivery.price,
        channel,
      })

      return order
    })
  }

  /**
   * The oldest in-stock delivery of a product — the one strict FIFO sells next. Used to show
   * the price and lot a purchase will actually use.
   */
  async getFifoLot(productId: number): Promise<Delivery | null> {
    return Delivery.query()
      .where('productId', productId)
      .where('amountLeft', '>', 0)
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .first()
  }

  /**
   * Atomic basket purchase — validates and buys all items in a single DB transaction.
   * Throws OutOfStockError (with deliveryId) if any item lacks sufficient stock.
   * Creates one Order row per unit to preserve the existing order model.
   */
  async purchaseBasket(
    buyerId: number,
    items: Array<{ deliveryId: number; quantity: number; expectedPrice?: number }>,
    channel: OrderChannel
  ): Promise<Order[]> {
    return db.transaction(async (trx) => {
      const orders: Order[] = []

      const requestedByDelivery = new Map<number, number>()
      const expectedPriceByDelivery = new Map<number, number>()
      for (const item of items) {
        requestedByDelivery.set(
          item.deliveryId,
          (requestedByDelivery.get(item.deliveryId) ?? 0) + item.quantity
        )
        if (item.expectedPrice !== undefined) {
          expectedPriceByDelivery.set(item.deliveryId, item.expectedPrice)
        }
      }

      // Lock every lot of the requested products in one statement, in the same order
      // purchase() uses (created_at, id per product). Locking the requested lots first and
      // the FIFO lots second took the same rows in two different orders, which could
      // deadlock against a concurrent single purchase.
      const requestedDeliveryIds = [...requestedByDelivery.keys()]
      const productRows = await Delivery.query({ client: trx })
        .whereIn('id', requestedDeliveryIds)
        .select('id', 'product_id')
      const lockedLots = await Delivery.query({ client: trx })
        .whereIn('productId', [...new Set(productRows.map((row) => row.productId))])
        .orderBy('productId', 'asc')
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc')
        .forUpdate()

      const deliveryMap = new Map(lockedLots.map((d) => [d.id, d]))

      for (const [deliveryId, quantity] of requestedByDelivery) {
        const delivery = deliveryMap.get(deliveryId)
        if (!delivery || delivery.amountLeft < quantity) {
          throw new OutOfStockError(deliveryId)
        }
        // The basket was built from what the kiosk showed; a price corrected since then
        // must not be charged silently.
        const expected = expectedPriceByDelivery.get(deliveryId)
        if (expected !== undefined && expected !== delivery.price) {
          throw new PriceChangedError(delivery.id, delivery.price)
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
      const fifoDeliveries = lockedLots.filter((d) => d.amountLeft > 0)

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
          const order = await Order.create(
            { buyerId, deliveryId, channel, unitPrice: delivery.price },
            { client: trx }
          )
          orders.push(order)
          await AuditService.log(buyerId, 'order.created', 'order', order.id, delivery.supplierId, {
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
        // Buyers only ever see the supplier's name — never their email, IBAN or keypad ID.
        q.preload('supplier', PUBLIC_USER_COLUMNS)
      })
      .preload('priceCorrection', (q) => q.select('id', 'reason', 'created_at'))
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
        .select(
          db.rawQuery('COUNT(*)::int as total_orders'),
          db.rawQuery('COALESCE(SUM(orders.unit_price), 0)::numeric as total_spend'),
          db.rawQuery(
            'COALESCE(SUM(CASE WHEN orders.invoice_id IS NULL THEN orders.unit_price ELSE 0 END), 0)::numeric as total_uninvoiced'
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
