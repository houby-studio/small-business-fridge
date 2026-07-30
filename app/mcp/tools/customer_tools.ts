import { z } from 'zod'
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type User from '#models/user'
import ShopService from '#services/shop_service'
import OrderService from '#services/order_service'
import InvoiceService from '#services/invoice_service'
import QrPaymentService from '#services/qr_payment_service'
import RecommendationService from '#services/recommendation_service'
import NotificationService from '#services/notification_service'
import Delivery from '#models/delivery'
import Invoice from '#models/invoice'
import Product from '#models/product'
import logger from '@adonisjs/core/services/logger'
import { ok, fail, mapDomainError, pageMeta } from '#mcp/tools/helpers'

/**
 * Tools available to every authenticated MCP user (customer, supplier, admin).
 * Cover the full self-service flow: browse shop → buy → check orders →
 * check invoices → request payment (+ QR code).
 */
export function registerCustomerTools(server: McpServer, user: User) {
  // ── list_products ───────────────────────────────────────────────────────────
  server.tool(
    'list_products',
    'List products in the fridge shop with current stock and price. ' +
      'Results respect your allergen preferences and favorites (favorites first). ' +
      'Each product includes `deliveryId` — the cheapest in-stock delivery lot, ' +
      'which is what you pass to buy_product. By default only in-stock products are returned.',
    {
      showOutOfStock: z
        .boolean()
        .optional()
        .describe('Set true to include products that are currently out of stock'),
    },
    async ({ showOutOfStock }): Promise<CallToolResult> => {
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
        return fail(`Error listing products: ${String(err)}`)
      }
    }
  )

  // ── list_categories ─────────────────────────────────────────────────────────
  server.tool(
    'list_categories',
    'List product categories available in the shop.',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const shop = new ShopService()
        const categories = await shop.getCategories()
        return ok({
          categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
        })
      } catch (err) {
        return fail(`Error listing categories: ${String(err)}`)
      }
    }
  )

  // ── buy_product ─────────────────────────────────────────────────────────────
  server.tool(
    'buy_product',
    'Buy a product from the fridge (1-click purchase, pay later via invoice). ' +
      'Pass either deliveryId (from list_products) or productId (the cheapest in-stock ' +
      'delivery lot is chosen automatically). Each unit creates one order. ' +
      'Quantity defaults to 1 (max 10 per call).',
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
        .describe('Product to buy — cheapest in-stock delivery lot is used'),
      quantity: z.number().int().min(1).max(10).optional().describe('Units to buy (default 1)'),
    },
    async ({ deliveryId, productId, quantity }): Promise<CallToolResult> => {
      try {
        if (!deliveryId && !productId) {
          return fail('Pass deliveryId or productId.')
        }

        let resolvedDeliveryId = deliveryId
        if (!resolvedDeliveryId) {
          const delivery = await Delivery.query()
            .where('productId', productId!)
            .where('amountLeft', '>', 0)
            .orderBy('price', 'asc')
            .first()
          if (!delivery) {
            return fail('The product is out of stock (error code: OUT_OF_STOCK).')
          }
          resolvedDeliveryId = delivery.id
        }

        const orders = new OrderService()
        const notifications = new NotificationService()
        const count = quantity ?? 1
        const orderIds: number[] = []
        let price = 0

        for (let i = 0; i < count; i++) {
          try {
            const order = await orders.purchase(user.id, resolvedDeliveryId, 'web')
            orderIds.push(order.id)
            notifications.sendPurchaseConfirmation(order).catch((err) => {
              logger.error({ err }, 'Failed to send purchase confirmation email')
            })
            if (price === 0) {
              const delivery = await Delivery.find(resolvedDeliveryId)
              price = delivery?.price ?? 0
            }
          } catch (err) {
            if (orderIds.length > 0) {
              return ok({
                orderIds,
                purchased: orderIds.length,
                requested: count,
                unitPrice: price,
                warning: `Only ${orderIds.length} of ${count} units purchased — the rest is out of stock.`,
              })
            }
            return mapDomainError(err, 'Purchase failed')
          }
        }

        return ok({
          orderIds,
          purchased: orderIds.length,
          unitPrice: price,
          totalCost: price * orderIds.length,
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
    'List your orders (purchases), newest first. Optionally filter by invoiced status.',
    {
      page: z.number().int().min(1).optional().describe('Page number (default 1)'),
      perPage: z.number().int().min(1).max(100).optional().describe('Items per page (default 20)'),
      invoiced: z
        .enum(['yes', 'no'])
        .optional()
        .describe('Filter: "yes" = already invoiced, "no" = not yet invoiced'),
    },
    async ({ page, perPage, invoiced }): Promise<CallToolResult> => {
      try {
        const orderService = new OrderService()
        const { orders } = await orderService.getOrdersForUser(user.id, page ?? 1, perPage ?? 20, {
          invoiced,
        })
        return ok({
          meta: pageMeta(orders),
          orders: orders.all().map((o) => ({
            orderId: o.id,
            product: o.delivery?.product?.displayName ?? null,
            supplier: o.delivery?.supplier?.displayName ?? null,
            price: o.delivery?.price ?? null,
            channel: o.channel,
            invoiced: o.invoiceId !== null && o.invoiceId !== undefined,
            invoiceId: o.invoiceId ?? null,
            createdAt: o.createdAt?.toISO() ?? null,
          })),
        })
      } catch (err) {
        return fail(`Error fetching orders: ${String(err)}`)
      }
    }
  )

  // ── get_my_invoices ─────────────────────────────────────────────────────────
  server.tool(
    'get_my_invoices',
    'List your invoices, newest first. Status: "unpaid" = waiting for you to pay, ' +
      '"awaiting" = you marked it paid and the supplier has not confirmed yet, ' +
      '"paid" = confirmed by the supplier.',
    {
      status: z.enum(['paid', 'unpaid', 'awaiting']).optional().describe('Filter by status'),
      page: z.number().int().min(1).optional().describe('Page number (default 1)'),
      perPage: z.number().int().min(1).max(100).optional().describe('Items per page (default 20)'),
    },
    async ({ status, page, perPage }): Promise<CallToolResult> => {
      try {
        const invoices = await new InvoiceService().getInvoicesForBuyer(
          user.id,
          page ?? 1,
          perPage ?? 20,
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
            'For an unpaid invoice: pay via bank transfer (use get_payment_qr for the QR/SPD ' +
            'payment string), then call request_payment to notify the supplier.',
        })
      } catch (err) {
        return fail(`Error fetching invoices: ${String(err)}`)
      }
    }
  )

  // ── get_payment_qr ──────────────────────────────────────────────────────────
  server.tool(
    'get_payment_qr',
    'Get the Czech SPD QR payment string (and bank details) for one of your invoices. ' +
      'The SPD string can be rendered as a QR code by any banking app.',
    {
      invoiceId: z.number().int().positive().describe('Your invoice ID'),
    },
    async ({ invoiceId }): Promise<CallToolResult> => {
      try {
        const invoice = await Invoice.query()
          .where('id', invoiceId)
          .where('buyerId', user.id)
          .preload('supplier')
          .first()

        if (!invoice) {
          return fail('Invoice not found (error code: NOT_FOUND).')
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
          note: 'After paying, call request_payment so the supplier can confirm.',
        })
      } catch (err) {
        return fail(`Error generating payment QR: ${String(err)}`)
      }
    }
  )

  // ── request_payment ─────────────────────────────────────────────────────────
  server.tool(
    'request_payment',
    'Mark one of your invoices as paid (after sending the bank transfer). ' +
      'The supplier then confirms or rejects the payment.',
    {
      invoiceId: z.number().int().positive().describe('Your invoice ID'),
    },
    async ({ invoiceId }): Promise<CallToolResult> => {
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
    'Withdraw a previously reported payment on one of your invoices (status returns to unpaid).',
    {
      invoiceId: z.number().int().positive().describe('Your invoice ID'),
    },
    async ({ invoiceId }): Promise<CallToolResult> => {
      try {
        const invoice = await new InvoiceService().cancelPaymentRequest(invoiceId, user.id)
        return ok({ invoiceId: invoice.id, status: 'unpaid' })
      } catch (err) {
        return mapDomainError(err, 'Cancelling payment request failed')
      }
    }
  )

  // ── get_recommendations ─────────────────────────────────────────────────────
  server.tool(
    'get_recommendations',
    'Get personally recommended products based on your purchase history.',
    {
      limit: z.number().int().min(1).max(12).optional().describe('Max results (default 4)'),
    },
    async ({ limit }): Promise<CallToolResult> => {
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
        return fail(`Error fetching recommendations: ${String(err)}`)
      }
    }
  )
}
