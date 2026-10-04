import { z } from 'zod'
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type User from '#models/user'
import ShopService from '#services/shop_service'
import OrderService from '#services/order_service'
import InvoiceService from '#services/invoice_service'
import QrPaymentService from '#services/qr_payment_service'
import RecommendationService from '#services/recommendation_service'
import NotificationService from '#services/notification_service'
import Invoice from '#models/invoice'
import Product from '#models/product'
import logger from '@adonisjs/core/services/logger'
import {
  ok,
  fail,
  failWithCode,
  mapDomainError,
  pageMeta,
  readOnly,
  destructive,
  idempotentWrite,
} from '#mcp/tools/helpers'

const page = () => z.number().int().min(1).optional().describe('Page number (default 1)')
const perPage = () =>
  z.number().int().min(1).max(100).optional().describe('Items per page (default 20)')

/**
 * Tools available to every authenticated MCP user (customer, supplier, admin).
 * Cover the full self-service flow: browse shop → buy → check orders →
 * check invoices → request payment (+ QR code).
 */
export function registerCustomerTools(server: McpServer, user: User) {
  // ── list_products ───────────────────────────────────────────────────────────
  server.tool(
    'list_products',
    "What you can buy from the fridge right now and at what price — the buyer's view, " +
      'respecting your allergen preferences, favourites first. Each product carries the ' +
      'deliveryId and price of the lot sold next (strict first-in-first-out); pass deliveryId ' +
      'to buy_product. Out-of-stock products only with showOutOfStock. Suppliers asking what ' +
      'is in stock or running out: use get_stock.',
    {
      showOutOfStock: z
        .boolean()
        .optional()
        .describe('Set true to include products that are currently out of stock'),
    },
    readOnly('Shop products'),
    async ({ showOutOfStock }) => {
      try {
        const shop = new ShopService()
        const products = await shop.getProducts({ showAll: !!showOutOfStock, userId: user.id })
        return ok({
          products: products.map((p) => ({
            productId: p.id,
            displayName: p.displayName,
            description: p.description,
            category: p.category.name,
            allergens: p.allergens.map((a) => a.name),
            stockSum: p.stockSum,
            price: p.price,
            deliveryId: p.deliveryId,
            isFavorite: p.isFavorite,
          })),
          count: products.length,
          note: 'Prices are in CZK. Pass deliveryId to buy_product to purchase.',
        })
      } catch (err) {
        return mapDomainError(err, 'Listing products failed')
      }
    }
  )

  // ── list_categories ─────────────────────────────────────────────────────────
  server.tool(
    'list_categories',
    'Product categories with their ids — the categoryId for create_product, ' +
      'create_product_group and the category filters.',
    {},
    readOnly('Categories'),
    async () => {
      try {
        const shop = new ShopService()
        const categories = await shop.getCategories()
        return ok({
          categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
        })
      } catch (err) {
        return mapDomainError(err, 'Listing categories failed')
      }
    }
  )

  // ── buy_product ─────────────────────────────────────────────────────────────
  server.tool(
    'buy_product',
    'Buy from the fridge for yourself — one click, paid later through an invoice. Pass ' +
      'deliveryId (from list_products) or productId. Pieces always come from the oldest ' +
      'in-stock lot (strict FIFO); if that lot costs anything other than expectedPrice, ' +
      'nothing is bought (PRICE_CHANGED). Each piece becomes one order. quantity defaults to 1, ' +
      'max 10 per call. Suppliers putting goods INTO the fridge: use add_stock.',
    {
      deliveryId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Delivery lot to buy from (preferred, from list_products)'),
      productId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Product to buy — the oldest in-stock delivery lot is used (FIFO)'),
      quantity: z.number().int().min(1).max(10).optional().describe('Pieces to buy (default 1)'),
      expectedPrice: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          'Price per piece you showed the user (from list_products). If the lot sold next costs anything else, nothing is bought (PRICE_CHANGED).'
        ),
    },
    destructive('Buy product'),
    async ({ deliveryId, productId, quantity, expectedPrice }) => {
      try {
        if (!deliveryId && !productId) {
          return failWithCode('VALIDATION', 'Pass deliveryId or productId')
        }

        let resolvedDeliveryId = deliveryId
        if (!resolvedDeliveryId) {
          const delivery = await new OrderService().getFifoLot(productId!)
          if (!delivery) {
            return failWithCode('OUT_OF_STOCK', 'Purchase failed')
          }
          resolvedDeliveryId = delivery.id
        }

        const orders = new OrderService()
        const notifications = new NotificationService()
        const count = quantity ?? 1
        const orderIds: number[] = []
        let price = 0
        let totalCost = 0

        for (let i = 0; i < count; i++) {
          try {
            const order = await orders.purchase(user.id, resolvedDeliveryId, 'web', expectedPrice)
            orderIds.push(order.id)
            notifications.sendPurchaseConfirmation(order).catch((err) => {
              logger.error({ err }, 'Failed to send purchase confirmation email')
            })
            if (price === 0) {
              price = order.unitPrice
            }
            totalCost += order.unitPrice
          } catch (err) {
            if (orderIds.length > 0) {
              const priceChanged = err instanceof Error && err.message === 'PRICE_CHANGED'
              return ok({
                orderIds,
                purchased: orderIds.length,
                requested: count,
                unitPrice: price,
                totalCost,
                warning: priceChanged
                  ? `Only ${orderIds.length} of ${count} pieces purchased — the next delivery lot has a different price; list the product again and confirm the new price.`
                  : `Only ${orderIds.length} of ${count} pieces purchased — the rest is out of stock.`,
              })
            }
            return mapDomainError(err, 'Purchase failed')
          }
        }

        return ok({
          orderIds,
          purchased: orderIds.length,
          unitPrice: price,
          totalCost,
          note: 'Purchase confirmed. Payment happens later via invoice (see get_my_invoices).',
        })
      } catch (err) {
        return mapDomainError(err, 'Purchase failed')
      }
    }
  )

  // ── get_my_orders ───────────────────────────────────────────────────────────
  server.tool(
    'get_my_orders',
    'Your own purchases (what you took from the fridge), newest first, with whether each is ' +
      'invoiced yet. For what other people bought from your lots use uninvoiced_summary or ' +
      'get_finance_summary.',
    {
      page: page(),
      perPage: perPage(),
      invoiced: z
        .enum(['yes', 'no'])
        .optional()
        .describe('Filter: "yes" = already invoiced, "no" = not yet invoiced'),
    },
    readOnly('My orders'),
    async ({ page: pageNo, perPage: size, invoiced }) => {
      try {
        const orderService = new OrderService()
        const { orders } = await orderService.getOrdersForUser(user.id, pageNo ?? 1, size ?? 20, {
          invoiced,
        })
        return ok({
          meta: pageMeta(orders),
          orders: orders.all().map((o) => ({
            orderId: o.id,
            product: o.delivery?.product?.displayName ?? null,
            supplier: o.delivery?.supplier?.displayName ?? null,
            price: o.unitPrice,
            channel: o.channel,
            invoiced: o.invoiceId !== null && o.invoiceId !== undefined,
            invoiceId: o.invoiceId ?? null,
            createdAt: o.createdAt?.toISO() ?? null,
          })),
        })
      } catch (err) {
        return mapDomainError(err, 'Fetching orders failed')
      }
    }
  )

  // ── get_my_invoices ─────────────────────────────────────────────────────────
  server.tool(
    'get_my_invoices',
    'Invoices you RECEIVED as a buyer (what you owe suppliers), newest first. Status ' +
      '"unpaid" = waiting for you to pay, "awaiting" = you reported the payment and the ' +
      'supplier has not confirmed yet, "paid" = confirmed. For invoices you issued as a ' +
      'supplier use list_issued_invoices.',
    {
      status: z.enum(['paid', 'unpaid', 'awaiting']).optional().describe('Filter by status'),
      page: page(),
      perPage: perPage(),
    },
    readOnly('My invoices'),
    async ({ status, page: pageNo, perPage: size }) => {
      try {
        const invoices = await new InvoiceService().getInvoicesForBuyer(
          user.id,
          pageNo ?? 1,
          size ?? 20,
          { status }
        )
        return ok({
          meta: pageMeta(invoices),
          invoices: invoices.all().map((inv) => ({
            invoiceId: inv.id,
            supplier: inv.supplier?.displayName ?? null,
            totalCost: inv.totalCost,
            status: inv.isPaid ? 'paid' : inv.isPaymentRequested ? 'awaiting' : 'unpaid',
            orderCount: inv.orders?.length ?? 0,
            createdAt: inv.createdAt?.toISO() ?? null,
          })),
          note:
            'CZK. For an unpaid invoice: pay via bank transfer (get_payment_qr gives the QR/SPD ' +
            'payment string), then call request_payment to notify the supplier.',
        })
      } catch (err) {
        return mapDomainError(err, 'Fetching invoices failed')
      }
    }
  )

  // ── get_payment_qr ──────────────────────────────────────────────────────────
  server.tool(
    'get_payment_qr',
    'Bank details and the Czech SPD payment string for an invoice you received (you are the ' +
      'buyer) — any banking app renders the SPD string as a QR code. Use after get_my_invoices; ' +
      'once paid, call request_payment.',
    {
      invoiceId: z.number().int().positive().describe('Invoice you received (get_my_invoices)'),
    },
    readOnly('Payment QR'),
    async ({ invoiceId }) => {
      try {
        const invoice = await Invoice.query()
          .where('id', invoiceId)
          .where('buyerId', user.id)
          .preload('supplier')
          .first()

        if (!invoice) {
          return failWithCode('NOT_FOUND', 'Generating the payment QR failed')
        }
        if (!invoice.supplier.iban) {
          return fail(
            'The supplier has no IBAN configured — pay them directly and ask them to confirm.'
          )
        }

        const qr = await new QrPaymentService().generate({
          iban: invoice.supplier.iban,
          amount: invoice.totalCost,
          receiverName: invoice.supplier.displayName,
          payerName: user.displayName,
        })

        return ok({
          invoiceId: invoice.id,
          amount: invoice.totalCost,
          iban: invoice.supplier.iban,
          receiver: invoice.supplier.displayName,
          spdCode: qr.code,
          note: 'CZK. After paying, call request_payment so the supplier can confirm.',
        })
      } catch (err) {
        return mapDomainError(err, 'Generating the payment QR failed')
      }
    }
  )

  // ── request_payment ─────────────────────────────────────────────────────────
  server.tool(
    'request_payment',
    'Report that you paid an invoice you received (you are the buyer) — after the bank ' +
      'transfer went out. The supplier then confirms or rejects it. To confirm money that ' +
      'arrived for an invoice you ISSUED use approve_payment.',
    {
      invoiceId: z.number().int().positive().describe('Invoice you received (get_my_invoices)'),
    },
    idempotentWrite('Report payment'),
    async ({ invoiceId }) => {
      try {
        const invoice = await new InvoiceService().requestPayment(invoiceId, user.id)
        return ok({
          invoiceId: invoice.id,
          status: 'awaiting',
          note: 'Payment reported. The supplier will confirm it.',
        })
      } catch (err) {
        return mapDomainError(err, 'Payment request failed')
      }
    }
  )

  // ── cancel_payment_request ──────────────────────────────────────────────────
  server.tool(
    'cancel_payment_request',
    'Withdraw a payment you reported on an invoice you received — e.g. the transfer did not ' +
      'go through. The status returns to "unpaid". Only while the supplier has not confirmed.',
    {
      invoiceId: z.number().int().positive().describe('Invoice you received (get_my_invoices)'),
    },
    idempotentWrite('Withdraw payment report'),
    async ({ invoiceId }) => {
      try {
        const invoice = await new InvoiceService().cancelPaymentRequest(invoiceId, user.id)
        return ok({ invoiceId: invoice.id, status: 'unpaid' })
      } catch (err) {
        return mapDomainError(err, 'Cancelling the payment request failed')
      }
    }
  )

  // ── get_recommendations ─────────────────────────────────────────────────────
  server.tool(
    'get_recommendations',
    'Products this user tends to buy for themselves, from their purchase history — for ' +
      'picking a snack or a drink, not for restocking the fridge (suppliers planning a ' +
      'shopping trip: use get_shopping_list).',
    {
      limit: z.number().int().min(1).max(12).optional().describe('Max results (default 4)'),
    },
    readOnly('Recommendations'),
    async ({ limit }) => {
      try {
        const ids = await new RecommendationService().getRecommendedIds(user.id, limit ?? 4)
        if (ids.length === 0) {
          return ok({ recommendations: [], note: 'No recommendations yet — buy something first.' })
        }
        const products = await Product.query().whereIn('id', ids).preload('category')
        const byId = new Map(products.map((p) => [p.id, p]))
        return ok({
          recommendations: ids
            .map((id) => byId.get(id))
            .filter((p) => p !== undefined)
            .map((p) => ({
              productId: p!.id,
              displayName: p!.displayName,
              category: p!.category?.name ?? null,
            })),
          note: 'Use list_products to get current price/stock, then buy_product.',
        })
      } catch (err) {
        return mapDomainError(err, 'Fetching recommendations failed')
      }
    }
  )
}
