import { z } from 'zod'
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import logger from '@adonisjs/core/services/logger'
import type User from '#models/user'
import Category from '#models/category'
import Delivery from '#models/delivery'
import Product from '#models/product'
import ProductGroup from '#models/product_group'
import type StockDraft from '#models/stock_draft'
import DeliveryService from '#services/delivery_service'
import FinanceService from '#services/finance_service'
import InventoryService from '#services/inventory_service'
import InvoiceService from '#services/invoice_service'
import NotificationService from '#services/notification_service'
import ProductService from '#services/product_service'
import AuditService from '#services/audit_service'
import { withProductKeypadId } from '#services/product_keypad_id'
import ProductGroupService from '#services/shopping/product_group_service'
import ShoppingListService, { type ShoppingLine } from '#services/shopping/shopping_list_service'
import StockDraftService, {
  StockDraftNeedsConfirmation,
  type StockDraftItemInput,
} from '#services/shopping/stock_draft_service'
import { roundMoney, suggestSellingPrice } from '#services/shopping/pricing'
import {
  CORRECTION_REASON_MAX_LENGTH,
  CORRECTION_REASON_MIN_LENGTH,
  DELIVERY_MAX_AMOUNT,
  DELIVERY_MAX_PRICE,
} from '#validators/delivery'
import { PRODUCT_BARCODE_MAX, PRODUCT_DESCRIPTION_MAX, PRODUCT_NAME_MAX } from '#validators/product'
import {
  ADJUSTMENT_NOTE_MAX,
  INVENTORY_MAX_ITEMS,
  INVENTORY_SCOPES,
  LOSS_REASONS,
  WRITE_OFF_REASONS,
} from '#validators/inventory'
import {
  PRODUCT_GROUP_NAME_MAX,
  PRODUCT_GROUP_NOTE_MAX,
  SHOPPING_LABEL_MAX,
  SHOPPING_NOTE_MAX,
  STOCK_DRAFT_MAX_ITEMS,
  STOCK_DRAFT_NOTE_MAX,
} from '#validators/shopping'
import {
  ok,
  failWithCode,
  mapDomainError,
  pageMeta,
  webUrl,
  readOnly,
  destructive,
  idempotentWrite,
  additiveWrite,
} from '#mcp/tools/helpers'

const page = () => z.number().int().min(1).optional().describe('Page number (default 1)')
const perPage = () =>
  z.number().int().min(1).max(100).optional().describe('Items per page (default 20)')

/** One line of a stocking draft — shared by create_stock_draft and update_stock_draft. */
const draftItemSchema = z.object({
  productId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Catalog product — only when list_catalog_products leaves no doubt'),
  groupId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Purchase group the line stands for while no product is picked'),
  label: z
    .string()
    .max(SHOPPING_LABEL_MAX)
    .optional()
    .describe('The line as the receipt wrote it — required without productId'),
  amount: z.number().int().min(1).max(DELIVERY_MAX_AMOUNT).describe('Pieces'),
  purchasePrice: z
    .number()
    .min(0)
    .max(DELIVERY_MAX_PRICE)
    .optional()
    .describe('Paid per piece, 2 decimals (divide a multipack by its pieces)'),
  price: z
    .number()
    .int()
    .min(1)
    .max(DELIVERY_MAX_PRICE)
    .optional()
    .describe("Selling price per piece, whole CZK; omit to derive it from the supplier's margin"),
})
type DraftItem = z.infer<typeof draftItemSchema>

function toDraftInput(items: DraftItem[]): StockDraftItemInput[] {
  return items.map((item) => ({
    productId: item.productId ?? null,
    productGroupId: item.groupId ?? null,
    label: item.label ?? null,
    amount: item.amount,
    purchasePrice: item.purchasePrice ?? null,
    price: item.price ?? null,
  }))
}

/** Index of the first line that names neither a product nor a label, or -1. */
function unnamedLine(items: DraftItem[]): number {
  return items.findIndex((item) => !item.productId && !item.label?.trim())
}

async function productNames(ids: Array<number | null | undefined>): Promise<Map<number, string>> {
  const unique = [...new Set(ids.filter((id): id is number => typeof id === 'number'))]
  if (unique.length === 0) return new Map()
  const products = await Product.query().whereIn('id', unique).select('id', 'displayName')
  return new Map(products.map((p) => [p.id, p.displayName]))
}

/** The draft as every draft tool returns it, with product names and what blocks stocking. */
async function describeDraft(draft: StockDraft) {
  const names = await productNames(draft.items.map((item) => item.productId))
  // A group line from the shopping list has no product yet — hand the agent the choice.
  const groupIds = [
    ...new Set(
      draft.items
        .filter((item) => item.productGroupId && !item.productId)
        .map((item) => item.productGroupId!)
    ),
  ]
  const groups = groupIds.length
    ? await ProductGroup.query()
        .whereIn('id', groupIds)
        .preload('products', (q) => q.orderBy('displayName', 'asc').select('id', 'displayName'))
    : []
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const items = draft.items.map((item, index) => {
    const group = item.productGroupId && !item.productId ? groupById.get(item.productGroupId) : null
    return {
      index,
      productId: item.productId,
      product: item.productId ? (names.get(item.productId) ?? null) : null,
      groupId: item.productGroupId,
      ...(group && {
        groupName: group.name,
        groupProducts: group.products.map((p) => ({ productId: p.id, name: p.displayName })),
      }),
      label: item.label,
      amount: item.amount,
      purchasePrice: item.purchasePrice,
      price: item.price,
      deliveryId: item.deliveryId,
    }
  })
  return {
    draftId: draft.id,
    status: draft.status,
    source: draft.source,
    note: draft.note,
    createdAt: draft.createdAt.toISO(),
    committedAt: draft.committedAt?.toISO() ?? null,
    reviewUrl: webUrl(`/supplier/stock/drafts/${draft.id}`),
    lines: items.length,
    pieces: items.reduce((sum, item) => sum + item.amount, 0),
    unmatched: items.filter((item) => item.productId === null).length,
    items,
    problems: StockDraftService.problems(draft.items),
  }
}

function compactLine(line: ShoppingLine) {
  return {
    key: line.key,
    kind: line.kind,
    name: line.name,
    productId: line.productId,
    groupId: line.groupId,
    category: line.categoryName,
    quantity: line.quantity,
    suggestedQuantity: line.suggestedQuantity,
    stock: line.stock,
    weeklyRate: line.weeklyRate,
    daysOfCover: line.daysOfCover,
    stockoutRisk: line.stockoutRisk,
    unitCost: line.unitCost,
    costSource: line.costSource,
    goodPrice: line.goodPrice,
    sellingPrice: line.sellingPrice,
    lineTotal: line.lineTotal,
    checked: line.isChecked,
    removed: line.isRemoved,
    note: line.note,
    hints: line.hints.map((h) => ({ productId: h.productId, name: h.name, stock: h.stock })),
    reasons: line.reasons,
  }
}

/** The shopping-list line with `key` after an edit — wherever the planner filed it. */
async function findLine(user: User, key: string) {
  const view = await new ShoppingListService().getView(user)
  const line = [...view.lines, ...view.covered, ...view.removed].find((l) => l.key === key)
  return line ? compactLine(line) : null
}

/** Favourite-product e-mails go out without delaying the tool result. */
function notifyRestock(delivery: Delivery): void {
  new NotificationService().sendRestockNotification(delivery).catch((err) => {
    logger.error({ err }, `Failed to send restock notifications for delivery #${delivery.id}`)
  })
}

/**
 * Tools for suppliers (and admins — admin implicitly has supplier access).
 * Cover the fridge's whole stock lifecycle: catalog → stock in (lots, drafts) → watch and
 * plan (stock, shopping list) → stock out (write-offs, counts, corrections) → invoice →
 * confirm payments → earnings.
 */
export function registerSupplierTools(server: McpServer, user: User) {
  // ── add_stock ───────────────────────────────────────────────────────────────
  server.tool(
    'add_stock',
    'Stock ONE product immediately as a new delivery lot — only when the user states the ' +
      'product, the pieces and a price themselves (e.g. "naskladni 24 kofol po 18"). The lot ' +
      'sells at once; nothing is reviewed. Use create_stock_draft instead for anything read ' +
      'from a receipt or photo, for more than one product, or when a product match or a price ' +
      'is uncertain. price = selling price per piece in whole CZK; purchasePrice = what you ' +
      'paid per piece (2 decimals). Give at least one — without price it is purchasePrice plus ' +
      'your margin, rounded up. Get productId from list_catalog_products, never guess it.',
    {
      productId: z.number().int().positive().describe('Product to stock (list_catalog_products)'),
      amount: z.number().int().min(1).max(DELIVERY_MAX_AMOUNT).describe('Pieces delivered'),
      price: z
        .number()
        .int()
        .min(1)
        .max(DELIVERY_MAX_PRICE)
        .optional()
        .describe('Selling price per piece in whole CZK (customers pay this)'),
      purchasePrice: z
        .number()
        .min(0)
        .max(DELIVERY_MAX_PRICE)
        .optional()
        .describe('What you paid per piece, 2 decimals (e.g. 14.90)'),
      confirmWarnings: z
        .boolean()
        .optional()
        .describe(
          'Set true only after the user saw the warnings of a previous call (a lot of this ' +
            'product stocked minutes ago, or a price far from the last one) and confirmed'
        ),
    },
    destructive('Add stock'),
    async ({ productId, amount, price, purchasePrice, confirmWarnings }) => {
      try {
        const product = await Product.find(productId)
        if (!product) return failWithCode('PRODUCT_NOT_FOUND', 'Adding stock failed')

        const sellingPrice =
          price ??
          (purchasePrice === undefined
            ? null
            : suggestSellingPrice(roundMoney(purchasePrice), Number(user.marginPercent ?? 0)))
        if (sellingPrice === null) return failWithCode('PRICE_REQUIRED', 'Adding stock failed')

        const deliveryService = new DeliveryService()
        if (!confirmWarnings) {
          const warnings = await deliveryService.getStockWarnings(user.id, productId, sellingPrice)
          if (warnings) {
            return ok({
              stocked: false,
              product: product.displayName,
              price: sellingPrice,
              warnings,
              note:
                'Nothing stocked. duplicate = you stocked this product minutes ago (a double ' +
                'submit?); unusualPrice = the price is far from the last lot. Show this to the ' +
                'user and call again with confirmWarnings: true only if they confirm.',
            })
          }
        }

        const delivery = await deliveryService.addStock(user.id, productId, amount, price ?? null, {
          purchasePrice: purchasePrice ?? null,
          marginPercent: Number(user.marginPercent ?? 0),
        })
        notifyRestock(delivery)

        return ok({
          stocked: true,
          deliveryId: delivery.id,
          productId,
          product: product.displayName,
          amount,
          price: delivery.price,
          purchasePrice: delivery.purchasePrice,
          note: 'Stocked. Customers can buy from this lot immediately; void_delivery undoes it while nothing sold.',
        })
      } catch (err) {
        return mapDomainError(err, 'Adding stock failed')
      }
    }
  )

  // ── get_stock ───────────────────────────────────────────────────────────────
  server.tool(
    'get_stock',
    'Current stock per product — the whole fridge by default or only your lots: pieces ' +
      'supplied, left and sold, stock value, the low-stock list (≤4 pieces left and still ' +
      'selling) and 30-day top sellers. Use it for "what is in the fridge / running out / ' +
      'selling". Use recent_deliveries for individual lots and list_catalog_products to find ' +
      'a productId.',
    {
      scope: z
        .enum(['all', 'mine'])
        .optional()
        .describe('"all" = the whole fridge (default), "mine" = only your lots'),
      stockState: z
        .enum(['all', 'low', 'out'])
        .optional()
        .describe('"low" = 1–4 pieces left, "out" = sold out (default "all")'),
      categoryId: z.number().int().positive().optional().describe('Filter by category'),
      page: page(),
      perPage: perPage(),
    },
    readOnly('Stock overview'),
    async ({ scope, stockState, categoryId, page: pageNo, perPage: size }) => {
      try {
        const stock = await new DeliveryService().getStockForSupplier(
          user.id,
          pageNo ?? 1,
          size ?? 20,
          { scope: scope ?? 'all', stockState, categoryId, withInsights: true }
        )
        const insights = stock.insights!
        return ok({
          scope: scope ?? 'all',
          meta: stock.meta,
          totals: stock.totals,
          lowStockCount: stock.lowStockCount,
          lowStockItems: insights.lowStockItems.map((r) => ({
            productId: r.productId,
            productName: r.productName,
            totalRemaining: r.totalRemaining,
            soldInPeriod: r.soldInPeriod,
          })),
          outOfStockCount: insights.outOfStockCount,
          topMovers: insights.topMovers.map((r) => ({
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
          note: 'Pieces and CZK. totalRemaining is the system stock to pass as expected to record_inventory_count.',
        })
      } catch (err) {
        return mapDomainError(err, 'Fetching stock failed')
      }
    }
  )

  // ── recent_deliveries ───────────────────────────────────────────────────────
  server.tool(
    'recent_deliveries',
    'Your individual delivery lots, newest first — which lot was stocked when, at what ' +
      'prices, how much is left or lost. Use it to find the deliveryId for void_delivery or ' +
      'correct_delivery, or to check what was stocked recently. For totals per product use ' +
      'get_stock.',
    {
      productId: z.number().int().positive().optional().describe('Only lots of this product'),
      scope: z
        .enum(['mine', 'all'])
        .optional()
        .describe('"mine" = your lots (default), "all" = everyone\'s'),
      includeVoided: z
        .boolean()
        .optional()
        .describe('Also list voided (cancelled) lots — hidden by default'),
      page: page(),
      perPage: perPage(),
    },
    readOnly('Recent deliveries'),
    async ({ productId, scope, includeVoided, page: pageNo, perPage: size }) => {
      try {
        const query = Delivery.query()
          .preload('product')
          .preload('supplier')
          .preload('corrections')
          .orderBy('createdAt', 'desc')
          .orderBy('id', 'desc')
        if (scope !== 'all') query.where('supplierId', user.id)
        if (productId) query.where('productId', productId)
        if (!includeVoided) query.whereNull('voidedAt')
        const deliveries = await query.paginate(pageNo ?? 1, size ?? 20)

        return ok({
          scope: scope ?? 'mine',
          meta: pageMeta(deliveries),
          deliveries: deliveries.all().map((d) => ({
            deliveryId: d.id,
            productId: d.productId,
            product: d.product?.displayName ?? null,
            supplier: d.supplier?.displayName ?? null,
            amountSupplied: d.amountSupplied,
            amountLeft: d.amountLeft,
            amountLost: d.amountLost,
            price: d.price,
            purchasePrice: d.purchasePrice,
            corrections: d.corrections?.length ?? 0,
            voided: d.voidedAt !== null && d.voidedAt !== undefined,
            createdAt: d.createdAt?.toISO() ?? null,
          })),
        })
      } catch (err) {
        return mapDomainError(err, 'Fetching deliveries failed')
      }
    }
  )

  // ── list_catalog_products ───────────────────────────────────────────────────
  server.tool(
    'list_catalog_products',
    'Find a product in the shared catalog by name or barcode, including out-of-stock ones — ' +
      'the way to get a productId for add_stock, create_stock_draft or update_product. ' +
      'Returns no stock figures; use get_stock or list_products for those.',
    {
      search: z
        .string()
        .optional()
        .describe('Words to match in the name or barcode, in any order ("pepsi plech")'),
      categoryId: z.number().int().positive().optional().describe('Filter by category'),
      page: page(),
      perPage: perPage(),
    },
    readOnly('Search the catalog'),
    async ({ search, categoryId, page: pageNo, perPage: size }) => {
      try {
        const products = await new ProductService().getProductsPaginated(pageNo ?? 1, size ?? 20, {
          search,
          categoryId,
        })
        const groupIds = [
          ...new Set(
            products
              .all()
              .map((p) => p.productGroupId)
              .filter((id): id is number => typeof id === 'number')
          ),
        ]
        const groups = groupIds.length
          ? await ProductGroup.query().whereIn('id', groupIds).select('id', 'name')
          : []
        const groupNames = new Map(groups.map((g) => [g.id, g.name]))

        return ok({
          meta: pageMeta(products),
          products: products.all().map((p) => ({
            productId: p.id,
            keypadId: p.keypadId,
            displayName: p.displayName,
            description: p.description,
            barcode: p.barcode,
            category: p.category?.name ?? null,
            groupId: p.productGroupId ?? null,
            groupName: p.productGroupId ? (groupNames.get(p.productGroupId) ?? null) : null,
            allergens: (p.allergens ?? []).map((a) => a.name),
            hasImage: !!p.imagePath,
          })),
        })
      } catch (err) {
        return mapDomainError(err, 'Listing the catalog failed')
      }
    }
  )

  // ── create_product ──────────────────────────────────────────────────────────
  server.tool(
    'create_product',
    'Add a product to the shared catalog — only after list_catalog_products found nothing ' +
      'matching (search by barcode, then by one distinctive word) and the user confirmed it ' +
      'is new. Never create products from receipt text; leave the draft line unmatched ' +
      'instead. Created without an image (add it later in the web UI); the keypad ID is ' +
      'assigned automatically. Idempotent by exact name (case-insensitive): an existing ' +
      'product of that name is returned.',
    {
      displayName: z.string().min(1).max(PRODUCT_NAME_MAX).describe('Name shown in the shop'),
      description: z.string().max(PRODUCT_DESCRIPTION_MAX).optional().describe('Short description'),
      categoryId: z.number().int().positive().describe('Category (list_categories)'),
      barcode: z.string().max(PRODUCT_BARCODE_MAX).optional().describe('EAN barcode'),
      allergenIds: z.array(z.number().int().positive()).optional().describe('Allergen IDs'),
      groupId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Purchase group (list_product_groups) — interchangeable products'),
    },
    idempotentWrite('Create product'),
    async ({ displayName, description, categoryId, barcode, allergenIds, groupId }) => {
      try {
        const existing = await Product.query().whereILike('displayName', displayName).first()
        if (existing) {
          return ok({
            productId: existing.id,
            keypadId: existing.keypadId,
            displayName: existing.displayName,
            existed: true,
            note: 'A product with this name already exists — returning it instead of creating a duplicate.',
          })
        }
        if (!(await Category.find(categoryId))) {
          return failWithCode('CATEGORY_NOT_FOUND', 'Creating product failed')
        }
        if (groupId && !(await ProductGroup.find(groupId))) {
          return failWithCode('GROUP_NOT_FOUND', 'Creating product failed')
        }

        const product = await withProductKeypadId(async (trx, nextKeypadId) => {
          const created = await Product.create(
            {
              keypadId: nextKeypadId,
              displayName,
              description: description ?? '',
              categoryId,
              barcode: barcode || null,
              productGroupId: groupId ?? null,
            },
            { client: trx }
          )
          if (allergenIds && allergenIds.length > 0) {
            await created.related('allergens').attach(allergenIds, trx)
          }
          return created
        })

        await AuditService.log(user.id, 'product.created', 'product', product.id, null, {
          name: product.displayName,
        })

        return ok({
          productId: product.id,
          keypadId: product.keypadId,
          displayName: product.displayName,
          existed: false,
          note: 'Created without an image — add one in the web UI. Stock it with add_stock or a draft.',
        })
      } catch (err) {
        return mapDomainError(err, 'Creating product failed')
      }
    }
  )

  // ── update_product ──────────────────────────────────────────────────────────
  server.tool(
    'update_product',
    'Change the metadata of a catalog product: name, description, category, barcode, ' +
      'allergens or purchase group (groupId: null takes it out of its group). Only the fields ' +
      'you pass change. Images can only be changed in the web UI; for stock or prices use ' +
      'add_stock / correct_delivery.',
    {
      productId: z.number().int().positive().describe('Product to update'),
      displayName: z.string().min(1).max(PRODUCT_NAME_MAX).optional(),
      description: z.string().max(PRODUCT_DESCRIPTION_MAX).optional(),
      categoryId: z.number().int().positive().optional(),
      barcode: z.string().max(PRODUCT_BARCODE_MAX).nullable().optional(),
      allergenIds: z.array(z.number().int().positive()).optional(),
      groupId: z
        .number()
        .int()
        .positive()
        .nullable()
        .optional()
        .describe('Purchase group (list_product_groups); null removes the product from it'),
    },
    idempotentWrite('Update product'),
    async ({ productId, displayName, description, categoryId, barcode, allergenIds, groupId }) => {
      try {
        const service = new ProductService()
        const product = await Product.find(productId)
        if (!product) return failWithCode('PRODUCT_NOT_FOUND', 'Updating product failed')
        if (categoryId !== undefined && !(await Category.find(categoryId))) {
          return failWithCode('CATEGORY_NOT_FOUND', 'Updating product failed')
        }
        if (groupId !== undefined && groupId !== null && !(await ProductGroup.find(groupId))) {
          return failWithCode('GROUP_NOT_FOUND', 'Updating product failed')
        }
        const before = await service.getProduct(productId)

        if (displayName !== undefined) product.displayName = displayName
        if (description !== undefined) product.description = description
        if (categoryId !== undefined) product.categoryId = categoryId
        if (barcode !== undefined) product.barcode = barcode || null
        if (groupId !== undefined) product.productGroupId = groupId
        await product.save()

        if (allergenIds !== undefined) {
          await product.related('allergens').sync(allergenIds)
        }

        await product.load('category')
        await product.load('allergens')
        await product.load('productGroup')
        const changes = ProductService.auditChanges(before, product)

        await AuditService.log(
          user.id,
          'product.updated',
          'product',
          product.id,
          null,
          Object.keys(changes).length ? changes : null
        )

        return ok({
          productId: product.id,
          displayName: product.displayName,
          changes,
          note: Object.keys(changes).length
            ? undefined
            : 'Nothing changed — the values were already set.',
        })
      } catch (err) {
        return mapDomainError(err, 'Updating product failed')
      }
    }
  )

  // ── uninvoiced_summary ──────────────────────────────────────────────────────
  server.tool(
    'uninvoiced_summary',
    'Who owes you how much for purchases not invoiced yet, grouped by buyer — the preview to ' +
      'show before generate_invoices. For invoices already issued use list_issued_invoices.',
    {},
    readOnly('Uninvoiced sales by buyer'),
    async () => {
      try {
        const summary = await new InvoiceService().getUninvoicedSummary(user.id)
        return ok({
          buyers: summary,
          totalUninvoiced: summary.reduce((s, r) => s + r.totalCost, 0),
          note: 'CZK. Confirm the buyers and the total with the user, then generate_invoices.',
        })
      } catch (err) {
        return mapDomainError(err, 'Fetching the uninvoiced summary failed')
      }
    }
  )

  // ── generate_invoices ───────────────────────────────────────────────────────
  server.tool(
    'generate_invoices',
    'Issue invoices for your uninvoiced sales — one per buyer, or only for buyerId. This ' +
      'e-mails the buyers and cannot be undone: call uninvoiced_summary first and confirm the ' +
      'buyers and the total with the user. Buyers pay by bank transfer; confirm their payments ' +
      'with approve_payment.',
    {
      buyerId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Only invoice this buyer (see uninvoiced_summary)'),
    },
    destructive('Generate invoices'),
    async ({ buyerId }) => {
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
            note: 'Invoice issued and e-mailed to the buyer.',
          })
        }
        const invoices = await invoiceService.generateInvoices(user.id)
        return ok({
          invoices: invoices.map((inv) => ({
            invoiceId: inv.id,
            buyerId: inv.buyerId,
            totalCost: inv.totalCost,
          })),
          note:
            invoices.length === 0
              ? 'No uninvoiced orders found.'
              : `${invoices.length} invoice(s) issued and e-mailed to the buyers.`,
        })
      } catch (err) {
        return mapDomainError(err, 'Generating invoices failed')
      }
    }
  )

  // ── list_issued_invoices ────────────────────────────────────────────────────
  server.tool(
    'list_issued_invoices',
    'Invoices you issued (you are the seller), newest first. Status "awaiting" = the buyer ' +
      'reported a payment that waits for your approve_payment / reject_payment; "unpaid" = ' +
      'nothing reported yet; "paid" = confirmed. For invoices you received as a buyer use ' +
      'get_my_invoices.',
    {
      status: z.enum(['paid', 'unpaid', 'awaiting']).optional().describe('Filter by status'),
      buyerId: z.number().int().positive().optional().describe('Filter by buyer'),
      page: page(),
      perPage: perPage(),
    },
    readOnly('Issued invoices'),
    async ({ status, buyerId, page: pageNo, perPage: size }) => {
      try {
        const invoices = await new InvoiceService().getInvoicesForSupplier(
          user.id,
          pageNo ?? 1,
          size ?? 20,
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
        return mapDomainError(err, 'Fetching invoices failed')
      }
    }
  )

  // ── approve_payment ─────────────────────────────────────────────────────────
  server.tool(
    'approve_payment',
    'Confirm that the money for an invoice you issued arrived — marks it paid and tells the ' +
      'buyer. Only for invoices in status "awaiting" (list_issued_invoices). To report your ' +
      'own payment of an invoice you received use request_payment.',
    {
      invoiceId: z.number().int().positive().describe('Invoice you issued'),
    },
    destructive('Approve payment'),
    async ({ invoiceId }) => {
      try {
        const invoice = await new InvoiceService().approvePayment(invoiceId, user.id)
        return ok({ invoiceId: invoice.id, status: 'paid', note: 'The buyer was notified.' })
      } catch (err) {
        return mapDomainError(err, 'Approving payment failed')
      }
    }
  )

  // ── reject_payment ──────────────────────────────────────────────────────────
  server.tool(
    'reject_payment',
    'Reject a payment a buyer reported on an invoice you issued because it did not arrive — ' +
      'the invoice goes back to "unpaid" and the buyer is told. Only for status "awaiting".',
    {
      invoiceId: z.number().int().positive().describe('Invoice you issued'),
    },
    destructive('Reject payment'),
    async ({ invoiceId }) => {
      try {
        const invoice = await new InvoiceService().rejectPayment(invoiceId, user.id)
        return ok({ invoiceId: invoice.id, status: 'unpaid', note: 'The buyer was notified.' })
      } catch (err) {
        return mapDomainError(err, 'Rejecting payment failed')
      }
    }
  )

  // ── get_shopping_list ───────────────────────────────────────────────────────
  server.tool(
    'get_shopping_list',
    "The supplier's restocking plan: what to buy for the FRIDGE on the next shopping trip, " +
      'how many pieces and at what price — computed from sales, stock and how often you shop, ' +
      'merged with your edits on the web. Not personal recommendations (that is ' +
      'get_recommendations). Lines of kind "group" are purchase groups: any product of the ' +
      'group will do, hints lists its best sellers. horizonDays, scope or categoryIds answer ' +
      'one question with other settings without saving them.',
    {
      horizonDays: z
        .number()
        .int()
        .min(1)
        .max(60)
        .optional()
        .describe('Days until the next trip (default: your usual interval)'),
      scope: z
        .enum(['mine', 'all'])
        .optional()
        .describe('"mine" = products you stock (default), "all" = the whole fridge'),
      categoryIds: z.array(z.number().int().positive()).optional().describe('Only these'),
    },
    readOnly('Shopping list'),
    async ({ horizonDays, scope, categoryIds }) => {
      try {
        const view = await new ShoppingListService().getView(user, {
          horizonDays,
          scope,
          categoryIds,
        })
        return ok({
          settings: view.settings,
          openDaysInHorizon: view.openDaysInHorizon,
          totals: view.totals,
          lines: view.lines.map(compactLine),
          enoughStock: view.covered.map((line) => ({
            key: line.key,
            name: line.name,
            stock: line.stock,
            daysOfCover: line.daysOfCover,
          })),
          note:
            'quantity = pieces to buy; unitCost = expected purchase price per piece (CZK, 2 ' +
            'decimals); costSource "selling" means no purchase price was recorded yet — ' +
            'unitCost is then the usual selling price. goodPrice = worth stocking up at or ' +
            'below it. Change a line with update_shopping_list_line, add one with ' +
            'add_shopping_list_line, or edit on the web: ' +
            webUrl('/supplier/shopping-list'),
        })
      } catch (err) {
        return mapDomainError(err, 'Building the shopping list failed')
      }
    }
  )

  // ── update_shopping_list_line ───────────────────────────────────────────────
  server.tool(
    'update_shopping_list_line',
    "Change one line of the supplier's saved shopping list: pieces to buy, expected price per " +
      'piece, tick it as bought, hide it or add a note. key comes from get_shopping_list ' +
      '(g-<groupId>, p-<productId>, c-<itemId>). quantity or unitCost = null returns to the ' +
      "planner's suggestion. These edits ARE saved and show on the web.",
    {
      key: z
        .string()
        .regex(/^[gpc]-\d+$/)
        .describe('Line key from get_shopping_list'),
      quantity: z
        .number()
        .int()
        .min(0)
        .max(DELIVERY_MAX_AMOUNT)
        .nullable()
        .optional()
        .describe('Pieces to buy; 0 skips the line this trip, null = back to the suggestion'),
      unitCost: z
        .number()
        .min(0)
        .max(DELIVERY_MAX_PRICE)
        .nullable()
        .optional()
        .describe('Expected purchase price per piece, 2 decimals; null = back to the estimate'),
      isChecked: z.boolean().optional().describe('true = ticked as bought'),
      isRemoved: z.boolean().optional().describe('true hides the line (restorable on the web)'),
      note: z.string().max(SHOPPING_NOTE_MAX).nullable().optional().describe('Shown on the line'),
    },
    idempotentWrite('Edit shopping-list line'),
    async ({ key, quantity, unitCost, isChecked, isRemoved, note }) => {
      try {
        const patch = { quantity, unitCost, isChecked, isRemoved, note }
        if (Object.values(patch).every((value) => value === undefined)) {
          return failWithCode(
            'VALIDATION',
            'Pass at least one of quantity, unitCost, isChecked, isRemoved or note'
          )
        }
        await new ShoppingListService().updateLine(user.id, key, patch)
        const line = await findLine(user, key)
        return ok({
          key,
          line,
          note: line
            ? 'Saved. The web list shows the change.'
            : 'Saved. The line no longer appears on the list.',
        })
      } catch (err) {
        return mapDomainError(err, 'Updating the shopping-list line failed')
      }
    }
  )

  // ── add_shopping_list_line ──────────────────────────────────────────────────
  server.tool(
    'add_shopping_list_line',
    'Put something on the shopping list the planner did not suggest — a catalog product ' +
      "(a colleague's wish, a promotion) or free text. Pass productId or label. For a line " +
      'that is already on the list use update_shopping_list_line.',
    {
      productId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Catalog product (list_catalog_products)'),
      label: z
        .string()
        .min(1)
        .max(SHOPPING_LABEL_MAX)
        .optional()
        .describe('Free text when there is no productId, e.g. "Mléko do kávy"'),
      quantity: z.number().int().min(1).max(DELIVERY_MAX_AMOUNT).describe('Pieces to buy'),
      unitCost: z
        .number()
        .min(0)
        .max(DELIVERY_MAX_PRICE)
        .optional()
        .describe('Expected purchase price per piece, 2 decimals'),
      note: z.string().max(SHOPPING_NOTE_MAX).optional().describe('Shown on the line'),
    },
    additiveWrite('Add shopping-list line'),
    async ({ productId, label, quantity, unitCost, note }) => {
      try {
        if (!productId && !label?.trim()) {
          return failWithCode('VALIDATION', 'Pass productId or label')
        }
        const key = await new ShoppingListService().addLine(user.id, {
          productId: productId ?? null,
          label: label ?? null,
          quantity,
          unitCost: unitCost ?? null,
          note: note ?? null,
        })
        return ok({ key, line: await findLine(user, key), note: 'Added to the saved list.' })
      } catch (err) {
        return mapDomainError(err, 'Adding the shopping-list line failed')
      }
    }
  )

  // ── list_product_groups ─────────────────────────────────────────────────────
  server.tool(
    'list_product_groups',
    'Purchase groups — interchangeable products (e.g. "energy drink with sugar") the ' +
      'shopping list plans as one line — with their members. Use the ids as groupId in ' +
      'create_product, update_product and create_product_group.',
    {},
    readOnly('Purchase groups'),
    async () => {
      try {
        const groups = await new ProductGroupService().list()
        return ok({
          groups: groups.map((g) => ({
            groupId: g.id,
            name: g.name,
            note: g.note,
            categoryId: g.categoryId,
            category: g.categoryName,
            products: g.productIds.map((id, index) => ({
              productId: id,
              name: g.productNames[index],
            })),
          })),
        })
      } catch (err) {
        return mapDomainError(err, 'Listing purchase groups failed')
      }
    }
  )

  // ── create_product_group ────────────────────────────────────────────────────
  server.tool(
    'create_product_group',
    'Create a purchase group of interchangeable products, optionally with members. ' +
      'Idempotent by name (case-insensitive): an existing group of that name is reused and ' +
      'the given products are ADDED to it (nothing is removed). To take a product out of a ' +
      'group use update_product with groupId: null.',
    {
      name: z.string().min(1).max(PRODUCT_GROUP_NAME_MAX).describe('e.g. "Energy drink bez cukru"'),
      categoryId: z.number().int().positive().describe('Category the group belongs to'),
      note: z
        .string()
        .max(PRODUCT_GROUP_NOTE_MAX)
        .optional()
        .describe('What counts as a member, e.g. "0,5 l plechovka" (0.5 l can)'),
      productIds: z.array(z.number().int().positive()).optional().describe('Members to put in'),
    },
    idempotentWrite('Create purchase group'),
    async ({ name, categoryId, note, productIds }) => {
      try {
        const service = new ProductGroupService()
        const existing = await ProductGroup.query().whereILike('name', name.trim()).first()
        if (existing) {
          const current = await Product.query().where('productGroupId', existing.id).select('id')
          const currentIds = current.map((p) => p.id)
          let added: number[] = []
          if (productIds?.length) {
            const wanted = await Product.query()
              .whereIn('id', productIds)
              .select('id', 'productGroupId')
            added = wanted.filter((p) => p.productGroupId !== existing.id).map((p) => p.id)
            if (added.length) {
              await service.update(user.id, existing.id, {
                name: existing.name,
                categoryId: existing.categoryId,
                note: existing.note,
                productIds: [...currentIds, ...added],
              })
            }
          }
          return ok({
            groupId: existing.id,
            name: existing.name,
            existed: true,
            addedProductIds: added,
            productIds: [...currentIds, ...added],
            note: added.length
              ? 'The group existed — the listed products were added to it.'
              : 'The group existed — nothing changed.',
          })
        }

        const group = await service.create(user.id, { name, categoryId, note, productIds })
        const members = await Product.query().where('productGroupId', group.id).select('id')
        return ok({
          groupId: group.id,
          name: group.name,
          existed: false,
          addedProductIds: members.map((p) => p.id),
          productIds: members.map((p) => p.id),
          note: 'Group created. The shopping list plans its members as one line.',
        })
      } catch (err) {
        return mapDomainError(err, 'Creating the purchase group failed')
      }
    }
  )

  // ── create_stock_draft ──────────────────────────────────────────────────────
  server.tool(
    'create_stock_draft',
    'Prepare a bulk stocking for the supplier to review on the web — for a receipt or photo, ' +
      'for several products, or whenever a product match or a price is uncertain. Nothing is ' +
      'stocked until the supplier opens reviewUrl and presses "Naskladnit" (Stock), or ' +
      'commit_stock_draft is called after they reviewed the lines. Set productId only when ' +
      'list_catalog_products leaves no doubt; otherwise leave it out and keep the receipt ' +
      'text in label — never create_product from receipt text. purchasePrice is per piece ' +
      "(divide a multipack's price by its pieces); price may be left out.",
    {
      note: z
        .string()
        .max(STOCK_DRAFT_NOTE_MAX)
        .optional()
        .describe('Shown to the supplier, e.g. "Lidl 2. 10. — účtenka" (receipt)'),
      items: z.array(draftItemSchema).min(1).max(STOCK_DRAFT_MAX_ITEMS),
    },
    additiveWrite('Stocking draft from a receipt'),
    async ({ note, items }) => {
      try {
        const unnamed = unnamedLine(items)
        if (unnamed !== -1) {
          return failWithCode('VALIDATION', `Line ${unnamed} needs a productId or a label`)
        }
        const service = new StockDraftService()
        const created = await service.create(user.id, {
          source: 'mcp',
          note: note ?? null,
          items: toDraftInput(items),
        })
        const draft = await service.get(user, created.id)
        return ok({
          ...(await describeDraft(draft)),
          note:
            'Nothing is stocked yet. Ask the supplier to open reviewUrl, pick products for ' +
            'unmatched lines, check prices and press "Naskladnit" (Stock) — or fix lines here ' +
            'with update_stock_draft.',
        })
      } catch (err) {
        return mapDomainError(err, 'Creating the stocking draft failed')
      }
    }
  )

  // ── list_stock_drafts ───────────────────────────────────────────────────────
  server.tool(
    'list_stock_drafts',
    'Your open stocking drafts (prepared, not stocked yet): source, note, lines, pieces, ' +
      'unmatched lines, created. Use get_stock_draft for the lines of one draft; for stocked ' +
      'lots use recent_deliveries.',
    {},
    readOnly('Open stocking drafts'),
    async () => {
      try {
        const drafts = await new StockDraftService().listOpen(user.id)
        return ok({
          drafts: drafts.map((d) => ({
            draftId: d.id,
            source: d.source,
            note: d.note,
            createdAt: d.createdAt,
            lines: d.lines,
            pieces: d.pieces,
            unmatched: d.unmatched,
            isEmpty: d.isEmpty,
            reviewUrl: webUrl(`/supplier/stock/drafts/${d.id}`),
          })),
          note:
            drafts.length === 0
              ? 'No open drafts.'
              : 'source: "web" = started by hand, "mcp" = by an assistant, "shopping_list" = from a finished shopping list.',
        })
      } catch (err) {
        return mapDomainError(err, 'Listing stocking drafts failed')
      }
    }
  )

  // ── get_stock_draft ─────────────────────────────────────────────────────────
  server.tool(
    'get_stock_draft',
    'The lines of one stocking draft and what still blocks stocking it (problems: a line ' +
      'without a product or without any price). A line that came from a purchase group has ' +
      'groupProducts — pick its productId from them with update_stock_draft. Show the lines ' +
      'to the supplier before changing or committing the draft. For a list of drafts use ' +
      'list_stock_drafts.',
    { draftId: z.number().int().positive().describe('Draft (list_stock_drafts)') },
    readOnly('Stocking draft'),
    async ({ draftId }) => {
      try {
        const draft = await new StockDraftService().get(user, draftId)
        return ok(await describeDraft(draft))
      } catch (err) {
        return mapDomainError(err, 'Fetching the stocking draft failed')
      }
    }
  )

  // ── update_stock_draft ──────────────────────────────────────────────────────
  server.tool(
    'update_stock_draft',
    'Replace the lines of an open draft — e.g. after the supplier told you which product an ' +
      'unmatched line is. Send the COMPLETE list of lines (read it with get_stock_draft ' +
      'first); lines you leave out are removed. Nothing is stocked. For a draft that was ' +
      'already stocked use correct_delivery on its lots.',
    {
      draftId: z.number().int().positive().describe('Open draft (list_stock_drafts)'),
      note: z
        .string()
        .max(STOCK_DRAFT_NOTE_MAX)
        .nullable()
        .optional()
        .describe('New note; null clears it; omit to keep it'),
      items: z.array(draftItemSchema).min(1).max(STOCK_DRAFT_MAX_ITEMS),
    },
    idempotentWrite('Update stocking draft'),
    async ({ draftId, note, items }) => {
      try {
        const unnamed = unnamedLine(items)
        if (unnamed !== -1) {
          return failWithCode('VALIDATION', `Line ${unnamed} needs a productId or a label`)
        }
        const draft = await new StockDraftService().update(user, draftId, {
          note,
          items: toDraftInput(items),
        })
        const described = await describeDraft(draft)
        return ok({
          ...described,
          note:
            described.problems.length === 0
              ? 'Saved. Every line is complete — the supplier can stock it on the web, or commit_stock_draft once they said so.'
              : 'Saved. Lines in problems still need a product or a price before stocking.',
        })
      } catch (err) {
        return mapDomainError(err, 'Updating the stocking draft failed')
      }
    }
  )

  // ── discard_stock_draft ─────────────────────────────────────────────────────
  server.tool(
    'discard_stock_draft',
    'Throw an open draft away — a duplicate, or the supplier stocked it by hand. Nothing in ' +
      'the stock changes; the draft disappears from list_stock_drafts. For a draft already ' +
      'stocked use void_delivery on its lots.',
    { draftId: z.number().int().positive().describe('Open draft (list_stock_drafts)') },
    destructive('Discard stocking draft', true),
    async ({ draftId }) => {
      try {
        await new StockDraftService().discard(user, draftId)
        return ok({
          draftId,
          status: 'discarded',
          note: 'Discarded. Nothing in the stock changed.',
        })
      } catch (err) {
        return mapDomainError(err, 'Discarding the stocking draft failed')
      }
    }
  )

  // ── commit_stock_draft ──────────────────────────────────────────────────────
  server.tool(
    'commit_stock_draft',
    'Stock every line of a draft at once and close it — ONLY after you showed the supplier ' +
      'the lines (get_stock_draft) and they explicitly said to stock them; otherwise send ' +
      'them reviewUrl. Fails while a line has no product or no price (DRAFT_INCOMPLETE). A ' +
      "line without a selling price gets purchasePrice plus the supplier's margin. The lots " +
      'sell immediately.',
    {
      draftId: z.number().int().positive().describe('Open draft (list_stock_drafts)'),
      confirmWarnings: z
        .boolean()
        .optional()
        .describe(
          'Set true only after the user saw the warnings of a previous call (a lot stocked ' +
            'minutes ago, an unusual price) and confirmed'
        ),
    },
    destructive('Stock a draft'),
    async ({ draftId, confirmWarnings }) => {
      try {
        const result = await new StockDraftService().commit(user, draftId, { confirmWarnings })
        const names = await productNames(result.deliveries.map((d) => d.productId))
        return ok({
          draftId,
          stocked: true,
          deliveries: result.deliveries.map((d) => ({
            deliveryId: d.id,
            productId: d.productId,
            product: names.get(d.productId) ?? null,
            amount: d.amountSupplied,
            price: d.price,
            purchasePrice: d.purchasePrice,
          })),
          note: 'Stocked. Customers can buy from these lots now; void_delivery undoes a lot while nothing sold.',
        })
      } catch (err) {
        if (err instanceof StockDraftNeedsConfirmation) {
          return ok({
            draftId,
            stocked: false,
            warnings: err.warnings,
            note:
              'Nothing stocked. duplicate = a lot of this product was stocked minutes ago (a ' +
              'double submit?); unusualPrice = the price is far from the last lot. Show this ' +
              'to the user and call again with confirmWarnings: true only if they confirm.',
          })
        }
        return mapDomainError(err, 'Stocking the draft failed')
      }
    }
  )

  // ── write_off_stock ─────────────────────────────────────────────────────────
  server.tool(
    'write_off_stock',
    'Record pieces that left the fridge without being sold and whose fate you know — ' +
      'expired, damaged, stolen or another named reason. They come off the oldest lots first ' +
      '(as a sale would) and count as shrinkage in get_finance_summary. Cannot be undone. For ' +
      'a shelf count that finds an unexplained difference use record_inventory_count instead.',
    {
      productId: z.number().int().positive().describe('Product (get_stock)'),
      quantity: z.number().int().min(1).max(DELIVERY_MAX_AMOUNT).describe('Pieces lost'),
      reason: z.enum(WRITE_OFF_REASONS).describe('expired | damaged | stolen | other'),
      note: z.string().max(ADJUSTMENT_NOTE_MAX).optional().describe('Shown in the audit log'),
    },
    destructive('Write off stock'),
    async ({ productId, quantity, reason, note }) => {
      try {
        const product = await Product.find(productId)
        if (!product) return failWithCode('PRODUCT_NOT_FOUND', 'Writing off stock failed')
        const adjustments = await new InventoryService().writeOff(user, {
          productId,
          quantity,
          reason,
          note: note ?? null,
        })
        return ok({
          productId,
          product: product.displayName,
          quantity,
          reason,
          lots: adjustments.map((a) => ({ deliveryId: a.deliveryId, quantity: a.quantity })),
          note: 'Recorded as shrinkage — see get_finance_summary → shrinkage.byReason.',
        })
      } catch (err) {
        return mapDomainError(err, 'Writing off stock failed')
      }
    }
  )

  // ── void_delivery ───────────────────────────────────────────────────────────
  server.tool(
    'void_delivery',
    'Cancel a delivery lot nothing was sold from yet — a duplicate or a mistaken add_stock. ' +
      'The lot leaves the stock; the row stays in the history. Find deliveryId with ' +
      'recent_deliveries. If something already sold from the lot, lower its pieces with ' +
      'correct_delivery instead.',
    {
      deliveryId: z.number().int().positive().describe('Lot to void (recent_deliveries)'),
      reason: z
        .string()
        .min(CORRECTION_REASON_MIN_LENGTH)
        .max(CORRECTION_REASON_MAX_LENGTH)
        .describe('Why, e.g. "duplicate — stocked twice"'),
    },
    destructive('Void delivery'),
    async ({ deliveryId, reason }) => {
      try {
        const { delivery, correction } = await new DeliveryService().voidDelivery(
          user,
          deliveryId,
          reason
        )
        const names = await productNames([delivery.productId])
        return ok({
          deliveryId: delivery.id,
          productId: delivery.productId,
          product: names.get(delivery.productId) ?? null,
          amountSupplied: correction.oldAmountSupplied,
          price: correction.oldPrice,
          status: 'voided',
          note: 'The lot is out of the stock. The history keeps the row as voided.',
        })
      } catch (err) {
        return mapDomainError(err, 'Voiding the delivery failed')
      }
    }
  )

  // ── correct_delivery ────────────────────────────────────────────────────────
  server.tool(
    'correct_delivery',
    'Fix the pieces, the selling price or the purchase price of a lot after stocking. Pieces ' +
      'can only go down and never below what sold; a new selling price applies to the ' +
      'remaining pieces and to purchases from this lot not invoiced yet (issued invoices never ' +
      'change). Pass both amount and price — the current value for the one that stays. For a ' +
      'lot nothing sold from use void_delivery.',
    {
      deliveryId: z.number().int().positive().describe('Lot to correct (recent_deliveries)'),
      amount: z
        .number()
        .int()
        .min(1)
        .max(DELIVERY_MAX_AMOUNT)
        .describe('New total pieces of the lot (current value to keep it)'),
      price: z
        .number()
        .int()
        .min(1)
        .max(DELIVERY_MAX_PRICE)
        .describe('Selling price per piece, whole CZK (current value to keep it)'),
      purchasePrice: z
        .number()
        .min(0)
        .max(DELIVERY_MAX_PRICE)
        .nullable()
        .optional()
        .describe('What you paid per piece, 2 decimals; null clears it; omit to keep it'),
      reason: z
        .string()
        .min(CORRECTION_REASON_MIN_LENGTH)
        .max(CORRECTION_REASON_MAX_LENGTH)
        .describe('Why, e.g. "typed 18 instead of 28"'),
    },
    destructive('Correct delivery'),
    async ({ deliveryId, amount, price, purchasePrice, reason }) => {
      try {
        const { delivery, correction, repricedOrderIds } =
          await new DeliveryService().correctDelivery(user, deliveryId, {
            amount,
            price,
            purchasePrice,
            reason,
          })
        const names = await productNames([delivery.productId])
        return ok({
          deliveryId: delivery.id,
          productId: delivery.productId,
          product: names.get(delivery.productId) ?? null,
          amountSupplied: { from: correction.oldAmountSupplied, to: correction.newAmountSupplied },
          amountLeft: delivery.amountLeft,
          price: { from: correction.oldPrice, to: correction.newPrice },
          purchasePrice: { from: correction.oldPurchasePrice, to: correction.newPurchasePrice },
          repricedOrders: repricedOrderIds.length,
          note:
            repricedOrderIds.length > 0
              ? `${repricedOrderIds.length} uninvoiced purchase(s) from this lot now carry the new price.`
              : 'Corrected. No uninvoiced purchase was repriced.',
        })
      } catch (err) {
        return mapDomainError(err, 'Correcting the delivery failed')
      }
    }
  )

  // ── record_inventory_count ──────────────────────────────────────────────────
  server.tool(
    'record_inventory_count',
    'Save a shelf count. For each product pass the pieces counted and expected = the system ' +
      'stock at the time of counting (take it from get_stock totalRemaining BEFORE the user ' +
      'dictates). Missing pieces are written off the oldest lots without a reason (give one ' +
      'later with classify_inventory_loss); extra pieces go back onto the newest lot. Only the ' +
      'products you pass are touched. When you already know why pieces are missing use ' +
      'write_off_stock.',
    {
      scope: z
        .enum(INVENTORY_SCOPES)
        .describe('"mine" = only products you stock, "all" = the whole fridge'),
      note: z.string().max(ADJUSTMENT_NOTE_MAX).optional().describe('Shown on the count'),
      items: z
        .array(
          z.object({
            productId: z.number().int().positive(),
            expected: z
              .number()
              .int()
              .min(0)
              .describe('System stock when counted (get_stock totalRemaining)'),
            counted: z.number().int().min(0).describe('Pieces on the shelf'),
          })
        )
        .min(1)
        .max(INVENTORY_MAX_ITEMS),
    },
    destructive('Record inventory count'),
    async ({ scope, note, items }) => {
      try {
        const service = new InventoryService()
        const created = await service.commitCount(user, { scope, note: note ?? null, items })
        const count = await service.getCount(created.id)
        const lines = count.items.map((item) => ({
          productId: item.productId,
          product: item.product?.displayName ?? null,
          expected: item.expectedQty,
          counted: item.countedQty,
          applied: item.appliedQty,
        }))
        return ok({
          countId: count.id,
          scope: count.scope,
          products: lines.length,
          lossQuantity: lines.reduce((sum, l) => sum + Math.max(0, -l.applied), 0),
          surplusQuantity: lines.reduce((sum, l) => sum + Math.max(0, l.applied), 0),
          items: lines,
          detailUrl: webUrl(`/supplier/inventory/${count.id}`),
          note:
            'applied < 0 = pieces written off without a reason yet (classify_inventory_loss ' +
            'gives one), > 0 = pieces found and put back. The missing pieces count as ' +
            'shrinkage in get_finance_summary.',
        })
      } catch (err) {
        return mapDomainError(err, 'Recording the inventory count failed')
      }
    }
  )

  // ── classify_inventory_loss ─────────────────────────────────────────────────
  server.tool(
    'classify_inventory_loss',
    'Give the pieces an inventory count found missing of one product a reason, once it is ' +
      'known — expired, damaged, stolen, other ("inventory" = no reason yet). countId comes ' +
      'from record_inventory_count. Only a shortfall gets a reason; for pieces you lose ' +
      'outside a count use write_off_stock.',
    {
      countId: z.number().int().positive().describe('Inventory count (record_inventory_count)'),
      productId: z.number().int().positive().describe('Product whose missing pieces to explain'),
      reason: z.enum(LOSS_REASONS).describe('inventory | expired | damaged | stolen | other'),
    },
    idempotentWrite('Classify inventory loss'),
    async ({ countId, productId, reason }) => {
      try {
        const result = await new InventoryService().reclassifyCountLoss(
          user,
          countId,
          productId,
          reason
        )
        return ok({
          countId,
          productId,
          product: result.productName,
          reason,
          changed: result.changed,
          note: result.changed
            ? 'Saved. get_finance_summary → shrinkage.byReason reflects it.'
            : 'The missing pieces already had this reason — nothing changed.',
        })
      } catch (err) {
        return mapDomainError(err, 'Classifying the inventory loss failed')
      }
    }
  )

  // ── get_finance_summary ─────────────────────────────────────────────────────
  server.tool(
    'get_finance_summary',
    'Your earnings for one calendar year (default: this year): sales to other people, their ' +
      'purchase cost and gross profit, own consumption (your purchases from your own lots — ' +
      'not income), shrinkage by reason, net profit, the margin that just covers the ' +
      'shrinkage, and the yearly income limit if the instance sets one. lossRate is a ' +
      'fraction 0–1; *Percent fields are percentages.',
    {
      year: z.number().int().min(2000).max(2100).optional().describe('Default: this year'),
    },
    readOnly('Finance summary'),
    async ({ year }) => {
      try {
        const service = new FinanceService()
        const summary = await service.getSummary(
          user.id,
          year ?? service.currentYear(),
          Number(user.marginPercent ?? 0)
        )
        return ok({
          ...summary,
          note:
            'Money in CZK. lossRate is a fraction 0–1; achievedMarginPercent, ' +
            'breakEvenMarginPercent, marginPercent and incomeLimit.percent are percentages. ' +
            'lossCost values shrinkage at purchase prices (what net profit subtracts), ' +
            'lossValue at selling prices. Full report: ' +
            webUrl('/supplier/finance'),
        })
      } catch (err) {
        return mapDomainError(err, 'Computing the finance summary failed')
      }
    }
  )
}
