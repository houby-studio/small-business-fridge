import { z } from 'zod'
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type User from '#models/user'
import DeliveryService from '#services/delivery_service'
import InvoiceService from '#services/invoice_service'
import ProductService from '#services/product_service'
import AuditService from '#services/audit_service'
import Product from '#models/product'
import { withProductKeypadId } from '#services/product_keypad_id'
import { ok, fail, mapDomainError, pageMeta } from '#mcp/tools/helpers'

/**
 * Tools for suppliers (and admins — admin implicitly has supplier access).
 * Cover the stocking + invoicing lifecycle: manage catalog → add stock →
 * watch stock levels → generate invoices → confirm payments.
 */
export function registerSupplierTools(server: McpServer, user: User) {
  // ── add_stock ───────────────────────────────────────────────────────────────
  server.tool(
    'add_stock',
    'Add stock for a product — creates a new delivery lot with a unit price. ' +
      'Use list_catalog_products to find the productId.',
    {
      productId: z.number().int().positive().describe('Product to stock'),
      amount: z.number().int().min(1).max(1000).describe('Number of units delivered'),
      price: z.number().positive().describe('Unit price in CZK for this lot'),
    },
    async ({ productId, amount, price }): Promise<CallToolResult> => {
      try {
        const product = await Product.find(productId)
        if (!product) {
          return fail('Product not found (error code: NOT_FOUND).')
        }
        const delivery = await new DeliveryService().addStock(user.id, productId, amount, price)
        return ok({
          deliveryId: delivery.id,
          product: product.displayName,
          amount,
          unitPrice: price,
          note: 'Stock added. Customers can buy from this lot immediately.',
        })
      } catch (err) {
        return mapDomainError(err, 'Adding stock failed')
      }
    }
  )

  // ── get_stock ───────────────────────────────────────────────────────────────
  server.tool(
    'get_stock',
    'Stock overview grouped by product: supplied/remaining/sold, stock value, ' +
      'low-stock alerts and top movers (30-day activity). ' +
      'Scope "mine" = only your deliveries, "store" = whole fridge (default).',
    {
      scope: z.enum(['store', 'mine']).optional().describe('Default "store"'),
      categoryId: z.number().int().positive().optional().describe('Filter by category'),
      page: z.number().int().min(1).optional().describe('Page number (default 1)'),
      perPage: z.number().int().min(1).max(100).optional().describe('Items per page (default 20)'),
    },
    async ({ scope, categoryId, page, perPage }): Promise<CallToolResult> => {
      try {
        const stock = await new DeliveryService().getStockForSupplier(
          user.id,
          page ?? 1,
          perPage ?? 20,
          { scope: scope ?? 'store', categoryId }
        )
        return ok({
          meta: stock.meta,
          totals: stock.totals,
          lowStockItems: stock.insights.lowStockItems.map((r) => ({
            productId: r.productId,
            productName: r.productName,
            totalRemaining: r.totalRemaining,
            soldInPeriod: r.soldInPeriod,
          })),
          outOfStockCount: stock.insights.outOfStockCount,
          topMovers: stock.insights.topMovers.map((r) => ({
            productId: r.productId,
            productName: r.productName,
            soldInPeriod: r.soldInPeriod,
          })),
          products: stock.data.map((r) => ({
            productId: r.productId,
            productName: r.productName,
            category: r.categoryName,
            totalSupplied: r.totalSupplied,
            totalRemaining: r.totalRemaining,
            totalSold: r.totalSold,
            totalStockValue: r.totalStockValue,
            soldInPeriod: r.soldInPeriod,
          })),
        })
      } catch (err) {
        return fail(`Error fetching stock: ${String(err)}`)
      }
    }
  )

  // ── recent_deliveries ───────────────────────────────────────────────────────
  server.tool(
    'recent_deliveries',
    'List your recent delivery lots (newest first) with remaining amounts.',
    {
      productId: z.number().int().positive().optional().describe('Filter by product'),
      page: z.number().int().min(1).optional().describe('Page number (default 1)'),
      perPage: z.number().int().min(1).max(100).optional().describe('Items per page (default 20)'),
    },
    async ({ productId, page, perPage }): Promise<CallToolResult> => {
      try {
        const deliveries = await new DeliveryService().getRecentDeliveries(
          user.id,
          page ?? 1,
          perPage ?? 20,
          { productId }
        )
        return ok({
          meta: pageMeta(deliveries),
          deliveries: deliveries.all().map((d) => ({
            deliveryId: d.id,
            product: d.product?.displayName ?? null,
            amountSupplied: d.amountSupplied,
            amountLeft: d.amountLeft,
            unitPrice: d.price,
            createdAt: d.createdAt?.toISO() ?? null,
          })),
        })
      } catch (err) {
        return fail(`Error fetching deliveries: ${String(err)}`)
      }
    }
  )

  // ── list_catalog_products ───────────────────────────────────────────────────
  server.tool(
    'list_catalog_products',
    'Browse the shared product catalog (including out-of-stock products) with search. ' +
      'Use this to find productId for add_stock or update_product.',
    {
      search: z.string().optional().describe('Search by name or barcode'),
      categoryId: z.number().int().positive().optional().describe('Filter by category'),
      page: z.number().int().min(1).optional().describe('Page number (default 1)'),
      perPage: z.number().int().min(1).max(100).optional().describe('Items per page (default 20)'),
    },
    async ({ search, categoryId, page, perPage }): Promise<CallToolResult> => {
      try {
        const products = await new ProductService().getProductsPaginated(page ?? 1, perPage ?? 20, {
          search,
          categoryId,
        })
        return ok({
          meta: pageMeta(products),
          products: products.all().map((p) => ({
            productId: p.id,
            keypadId: p.keypadId,
            displayName: p.displayName,
            description: p.description,
            barcode: p.barcode,
            category: p.category?.name ?? null,
            allergens: (p.allergens ?? []).map((a) => a.name),
            hasImage: !!p.imagePath,
          })),
        })
      } catch (err) {
        return fail(`Error listing catalog: ${String(err)}`)
      }
    }
  )

  // ── create_product ──────────────────────────────────────────────────────────
  server.tool(
    'create_product',
    'Create a new product in the shared catalog (without an image — upload one later ' +
      'in the web UI under Supplier → Products). A keypad ID is assigned automatically. ' +
      'Idempotent by name: if a product with the same name already exists, it is returned instead.',
    {
      displayName: z.string().min(1).max(255).describe('Product name shown in the shop'),
      description: z.string().max(1000).optional().describe('Short description'),
      categoryId: z.number().int().positive().describe('Category ID (see list_categories)'),
      barcode: z.string().max(100).optional().describe('EAN barcode'),
      allergenIds: z.array(z.number().int().positive()).optional().describe('Allergen IDs'),
    },
    async ({
      displayName,
      description,
      categoryId,
      barcode,
      allergenIds,
    }): Promise<CallToolResult> => {
      try {
        const existing = await Product.query().whereILike('displayName', displayName).first()
        if (existing) {
          return ok({
            productId: existing.id,
            displayName: existing.displayName,
            existed: true,
            note: 'A product with this name already exists — returning it instead of creating a duplicate.',
          })
        }

        const product = await withProductKeypadId(async (trx, nextKeypadId) => {
          const created = await Product.create(
            {
              keypadId: nextKeypadId,
              displayName,
              description: description ?? '',
              categoryId,
              barcode: barcode || null,
            },
            { client: trx }
          )

          if (allergenIds && allergenIds.length > 0) {
            await created.related('allergens').attach(allergenIds, trx)
          }

          return created
        })

        await AuditService.log(user.id, 'product.created', 'product', product.id, null, {
          displayName,
          categoryId,
          via: 'mcp',
        })

        return ok({
          productId: product.id,
          keypadId: product.keypadId,
          displayName: product.displayName,
          existed: false,
          note: 'Product created without an image — add one in the web UI. Use add_stock to make it purchasable.',
        })
      } catch (err) {
        return mapDomainError(err, 'Creating product failed')
      }
    }
  )

  // ── update_product ──────────────────────────────────────────────────────────
  server.tool(
    'update_product',
    'Update product metadata (name, description, category, barcode, allergens). ' +
      'Images can only be changed in the web UI.',
    {
      productId: z.number().int().positive().describe('Product to update'),
      displayName: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
      categoryId: z.number().int().positive().optional(),
      barcode: z.string().max(64).nullable().optional(),
      allergenIds: z.array(z.number().int().positive()).optional(),
    },
    async ({ productId, displayName, description, categoryId, barcode, allergenIds }) => {
      try {
        const product = await Product.findOrFail(productId)

        if (displayName !== undefined) product.displayName = displayName
        if (description !== undefined) product.description = description
        if (categoryId !== undefined) product.categoryId = categoryId
        if (barcode !== undefined) product.barcode = barcode || null
        await product.save()

        if (allergenIds !== undefined) {
          await product.related('allergens').sync(allergenIds)
        }

        await AuditService.log(user.id, 'product.updated', 'product', product.id, null, {
          via: 'mcp',
        })

        return ok({ productId: product.id, displayName: product.displayName })
      } catch (err) {
        return mapDomainError(err, 'Updating product failed')
      }
    }
  )

  // ── uninvoiced_summary ──────────────────────────────────────────────────────
  server.tool(
    'uninvoiced_summary',
    'Summary of your uninvoiced orders grouped by buyer — who owes you how much ' +
      'before invoicing. Use generate_invoices to turn these into invoices.',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const summary = await new InvoiceService().getUninvoicedSummary(user.id)
        return ok({
          buyers: summary,
          totalUninvoiced: summary.reduce((s, r) => s + r.totalCost, 0),
        })
      } catch (err) {
        return fail(`Error fetching summary: ${String(err)}`)
      }
    }
  )

  // ── generate_invoices ───────────────────────────────────────────────────────
  server.tool(
    'generate_invoices',
    'Generate invoices for your uninvoiced orders. Without buyerId: one invoice per buyer ' +
      'covering all their uninvoiced orders. With buyerId: only for that buyer. ' +
      'Buyers are notified by email and pay via bank transfer.',
    {
      buyerId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Only invoice this buyer (see uninvoiced_summary)'),
    },
    async ({ buyerId }): Promise<CallToolResult> => {
      try {
        const invoiceService = new InvoiceService()
        if (buyerId) {
          const invoice = await invoiceService.generateInvoiceForBuyer(user.id, buyerId)
          if (!invoice) {
            return ok({ invoices: [], note: 'No uninvoiced orders for this buyer.' })
          }
          return ok({
            invoices: [
              { invoiceId: invoice.id, buyerId: invoice.buyerId, totalCost: invoice.totalCost },
            ],
          })
        }
        const invoices = await invoiceService.generateInvoices(user.id)
        return ok({
          invoices: invoices.map((inv) => ({
            invoiceId: inv.id,
            buyerId: inv.buyerId,
            totalCost: inv.totalCost,
          })),
          note: invoices.length === 0 ? 'No uninvoiced orders found.' : undefined,
        })
      } catch (err) {
        return mapDomainError(err, 'Generating invoices failed')
      }
    }
  )

  // ── list_issued_invoices ────────────────────────────────────────────────────
  server.tool(
    'list_issued_invoices',
    'List invoices you issued, newest first. Status "awaiting" means the buyer reported ' +
      'a payment that waits for your confirmation (approve_payment / reject_payment).',
    {
      status: z.enum(['paid', 'unpaid', 'awaiting']).optional().describe('Filter by status'),
      buyerId: z.number().int().positive().optional().describe('Filter by buyer'),
      page: z.number().int().min(1).optional().describe('Page number (default 1)'),
      perPage: z.number().int().min(1).max(100).optional().describe('Items per page (default 20)'),
    },
    async ({ status, buyerId, page, perPage }): Promise<CallToolResult> => {
      try {
        const invoices = await new InvoiceService().getInvoicesForSupplier(
          user.id,
          page ?? 1,
          perPage ?? 20,
          { status, buyerId }
        )
        return ok({
          meta: pageMeta(invoices),
          invoices: invoices.all().map((inv) => ({
            invoiceId: inv.id,
            buyer: inv.buyer?.displayName ?? null,
            buyerId: inv.buyerId,
            totalCost: inv.totalCost,
            status: inv.isPaid ? 'paid' : inv.isPaymentRequested ? 'awaiting' : 'unpaid',
            orderCount: inv.orders?.length ?? 0,
            createdAt: inv.createdAt?.toISO() ?? null,
          })),
        })
      } catch (err) {
        return fail(`Error fetching invoices: ${String(err)}`)
      }
    }
  )

  // ── approve_payment ─────────────────────────────────────────────────────────
  server.tool(
    'approve_payment',
    'Confirm that you received the payment for one of your issued invoices (marks it paid).',
    {
      invoiceId: z.number().int().positive().describe('Invoice you issued'),
    },
    async ({ invoiceId }): Promise<CallToolResult> => {
      try {
        const invoice = await new InvoiceService().approvePayment(invoiceId, user.id)
        return ok({ invoiceId: invoice.id, status: 'paid' })
      } catch (err) {
        return mapDomainError(err, 'Approving payment failed')
      }
    }
  )

  // ── reject_payment ──────────────────────────────────────────────────────────
  server.tool(
    'reject_payment',
    'Reject a reported payment on one of your issued invoices (marks it unpaid again).',
    {
      invoiceId: z.number().int().positive().describe('Invoice you issued'),
    },
    async ({ invoiceId }): Promise<CallToolResult> => {
      try {
        const invoice = await new InvoiceService().rejectPayment(invoiceId, user.id)
        return ok({ invoiceId: invoice.id, status: 'unpaid' })
      } catch (err) {
        return mapDomainError(err, 'Rejecting payment failed')
      }
    }
  )
}
