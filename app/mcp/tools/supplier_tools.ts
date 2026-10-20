import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import i18nManager from '@adonisjs/i18n/services/main'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type User from '#models/user'
import Allergen from '#models/allergen'
import Category from '#models/category'
import Delivery from '#models/delivery'
import Product from '#models/product'
import ProductGroup from '#models/product_group'
import Invoice from '#models/invoice'
import type StockDraft from '#models/stock_draft'
import { FRIDGE_TIMEZONE } from '#config/fridge'
import DeliveryService from '#services/delivery_service'
import FinanceService from '#services/finance_service'
import InventoryService from '#services/inventory_service'
import InvoiceService from '#services/invoice_service'
import NotificationService from '#services/notification_service'
import ProductService from '#services/product_service'
import StockHistoryService from '#services/stock_history_service'
import { runAfterResponse } from '#services/side_effects'
import { isUniqueViolation } from '#services/unique_violation'
import AuditService from '#services/audit_service'
import { withProductKeypadId } from '#services/product_keypad_id'
import ProductGroupService from '#services/shopping/product_group_service'
import ShoppingListService, { type ShoppingLine } from '#services/shopping/shopping_list_service'
import StockDraftService, {
  StockDraftNeedsConfirmation,
  StockDraftUnknownReference,
  type StockDraftItemInput,
} from '#services/shopping/stock_draft_service'
import { roundMoney } from '#services/shopping/pricing'
import {
  CORRECTION_REASON_MAX_LENGTH,
  CORRECTION_REASON_MIN_LENGTH,
  DELIVERY_MAX_AMOUNT,
  DELIVERY_MAX_PRICE,
  REPRICE_MAX_LOTS,
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

/** A fix of one draft line by its index — update_stock_draft without resending every line. */
const draftLinePatchSchema = z.object({
  index: z.number().int().min(0).describe('Line index from get_stock_draft'),
  productId: z.number().int().positive().nullable().optional().describe('null unmatches it'),
  groupId: z.number().int().positive().nullable().optional(),
  label: z.string().max(SHOPPING_LABEL_MAX).nullable().optional(),
  amount: z.number().int().min(1).max(DELIVERY_MAX_AMOUNT).optional(),
  purchasePrice: z.number().min(0).max(DELIVERY_MAX_PRICE).nullable().optional(),
  price: z.number().int().min(1).max(DELIVERY_MAX_PRICE).nullable().optional(),
})
type DraftLinePatch = z.infer<typeof draftLinePatchSchema>

/**
 * The draft's lines with the patches applied. A line keeps every field the patch leaves out;
 * an index outside the draft or a line left without product and label fails.
 */
function applyLinePatches(
  current: StockDraftItemInput[],
  patches: DraftLinePatch[]
): { items: StockDraftItemInput[] } | { error: CallToolResult } {
  const items = current.map((item) => ({
    productId: item.productId ?? null,
    productGroupId: item.productGroupId ?? null,
    label: item.label ?? null,
    amount: item.amount,
    purchasePrice: item.purchasePrice ?? null,
    purchasePriceEstimated: item.purchasePriceEstimated ?? false,
    price: item.price ?? null,
    // A patched line keeps who put it on the draft (the list, the web, the assistant).
    source: item.source,
  }))
  for (const patch of patches) {
    const line = items[patch.index]
    if (!line) {
      return {
        error: failWithCode(
          'VALIDATION',
          `The draft has no line ${patch.index} — indexes run from 0 to ${items.length - 1}`
        ),
      }
    }
    if (patch.productId !== undefined) line.productId = patch.productId
    if (patch.groupId !== undefined) line.productGroupId = patch.groupId
    if (patch.label !== undefined) line.label = patch.label
    if (patch.amount !== undefined) line.amount = patch.amount
    if (patch.purchasePrice !== undefined) {
      // A price the agent read from the receipt is no estimate any more.
      line.purchasePrice = patch.purchasePrice
      line.purchasePriceEstimated = false
    }
    if (patch.price !== undefined) line.price = patch.price
    if (!line.productId && !line.label?.trim()) {
      return {
        error: failWithCode('VALIDATION', `Line ${patch.index} needs a productId or a label`),
      }
    }
  }
  return { items }
}

function toDraftInput(items: DraftItem[]): StockDraftItemInput[] {
  return items.map((item) => ({
    productId: item.productId ?? null,
    productGroupId: item.groupId ?? null,
    label: item.label ?? null,
    amount: item.amount,
    purchasePrice: item.purchasePrice ?? null,
    price: item.price ?? null,
    // Whatever the assistant writes is its line, also when it rewrites the whole draft.
    source: 'assistant' as const,
  }))
}

/** Index of the first line that names neither a product nor a label, or -1. */
function unnamedLine(items: DraftItem[]): number {
  return items.findIndex((item) => !item.productId && !item.label?.trim())
}

/** A draft line naming a product or group that does not exist — never dropped silently. */
function unknownReference(err: StockDraftUnknownReference): CallToolResult {
  const what = err.code === 'GROUP_NOT_FOUND' ? 'group' : 'product'
  return failWithCode(err.code, `Line ${err.index} names ${what} ${err.id}, which does not exist`)
}

/**
 * Allergen ids for names as list_catalog_products shows them (case-insensitive). An unknown
 * name fails with the valid names, so the agent can correct itself in one step.
 */
async function allergenIdsByName(
  names: string[]
): Promise<{ ids: number[] } | { error: CallToolResult }> {
  const allergens = await Allergen.query().where('isDisabled', false).orderBy('name', 'asc')
  const byName = new Map(allergens.map((a) => [a.name.trim().toLowerCase(), a.id]))
  const ids: number[] = []
  for (const name of names) {
    const id = byName.get(name.trim().toLowerCase())
    if (id === undefined) {
      return {
        error: failWithCode(
          'ALLERGEN_NOT_FOUND',
          `Unknown allergen "${name}" — valid: ${allergens.map((a) => a.name).join(', ')}`
        ),
      }
    }
    ids.push(id)
  }
  return { ids: [...new Set(ids)] }
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
      source: item.source,
      amount: item.amount,
      purchasePrice: item.purchasePrice,
      ...(item.purchasePriceEstimated && { purchasePriceEstimated: true }),
      price: item.price,
      deliveryId: item.deliveryId,
    }
  })
  return {
    draftId: draft.id,
    status: draft.status,
    note: draft.note,
    createdAt: draft.createdAt.toISO(),
    committedAt: draft.committedAt?.toISO() ?? null,
    reviewUrl: webUrl(`/supplier/stock/drafts/${draft.id}`),
    lines: items.length,
    pieces: items.reduce((sum, item) => sum + item.amount, 0),
    unmatched: items.filter((item) => item.productId === null).length,
    items,
    // A line without any price is fine when the product sold before: commit takes that price.
    problems: StockDraftService.problems(
      draft.items,
      await new StockDraftService().lastPrices(draft.supplierId, [...names.keys()])
    ),
  }
}

/** Drops empty fields (null, false, []) — a long list stays short for the agent. */
function withoutEmpty<T extends Record<string, unknown>>(row: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(row).filter(
      ([, value]) =>
        value !== null && value !== false && !(Array.isArray(value) && value.length === 0)
    )
  ) as Partial<T>
}

function compactLine(line: ShoppingLine) {
  return withoutEmpty({
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
  })
}

/** The shopping-list line with `key` after an edit — wherever the planner filed it. */
async function findLine(user: User, key: string) {
  const view = await new ShoppingListService().getView(user)
  const line = [...view.lines, ...view.covered, ...view.removed].find((l) => l.key === key)
  return line ? compactLine(line) : null
}

/** Favourite-product e-mails go out without delaying the tool result. */
function notifyRestock(delivery: Delivery): void {
  runAfterResponse(
    () => new NotificationService().sendRestockNotification(delivery),
    `restock notifications for delivery #${delivery.id}`
  )
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
      "your margin, rounded up, but never below the product's current price. Get productId " +
      'from list_catalog_products, never guess it.',
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

        const deliveryService = new DeliveryService()
        const paid = purchasePrice === undefined ? null : roundMoney(purchasePrice)
        // The same rule as the web and the drafts: margin on top, never below the current price.
        const sellingPrice = await deliveryService.resolveSellingPrice(
          productId,
          price ?? null,
          paid,
          Number(user.marginPercent ?? 0)
        )
        if (sellingPrice === null) return failWithCode('PRICE_REQUIRED', 'Adding stock failed')

        if (!confirmWarnings) {
          const warnings = await deliveryService.getStockWarnings(
            user.id,
            productId,
            sellingPrice,
            { purchasePrice: paid }
          )
          if (warnings) {
            return ok({
              stocked: false,
              product: product.displayName,
              price: sellingPrice,
              warnings,
              hint:
                'Nothing stocked. duplicate = you stocked this product minutes ago (a double ' +
                'submit?); unusualPrice = the price is far from the last lot; ' +
                'unusualPurchasePrice = far from what you paid last time (a pack price for a ' +
                'piece?). Show this to the user and call again with confirmWarnings: true only ' +
                'if they confirm.',
            })
          }
        }

        const delivery = await deliveryService.addStock(user.id, productId, amount, sellingPrice, {
          purchasePrice: paid,
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
          hint: 'Stocked. Customers can buy from this lot immediately; void_delivery undoes it while nothing sold.',
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
      'supplied, left and sold, stock value, the low-stock list (1–4 pieces left, still ' +
      'selling; lowStockCount counts them, outOfStockCount the sold-out ones) and 30-day top ' +
      'sellers. Use it for "what is in the fridge / running out / ' +
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
        // The insights do not depend on the page — only the first one carries them.
        const firstPage = (pageNo ?? 1) === 1
        return ok({
          scope: scope ?? 'all',
          meta: stock.meta,
          totals: stock.totals,
          lowStockCount: stock.lowStockCount,
          outOfStockCount: insights.outOfStockCount,
          ...(firstPage && {
            lowStockItems: insights.lowStockItems.map((r) => ({
              productId: r.productId,
              productName: r.productName,
              totalRemaining: r.totalRemaining,
              soldInPeriod: r.soldInPeriod,
            })),
            topMovers: insights.topMovers.map((r) => ({
              productId: r.productId,
              productName: r.productName,
              soldInPeriod: r.soldInPeriod,
            })),
          }),
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
          hint: 'Pieces and CZK. lowStockItems and topMovers come with page 1 only.',
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
      'correct_delivery (your own lots only), or to check what was stocked recently. ' +
      'scope "all" also lists colleagues\' lots, without their purchase prices. For totals ' +
      'per product use get_stock.',
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
            // What a colleague paid is theirs to know (admins see it).
            purchasePrice: DeliveryService.canSeePurchasePrice(user, d.supplierId)
              ? d.purchasePrice
              : null,
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
      includeArchived: z
        .boolean()
        .optional()
        .describe('Archived products are hidden by default; stocking one brings it back'),
      page: page(),
      perPage: perPage(),
    },
    readOnly('Search the catalog'),
    async ({ search, categoryId, includeArchived, page: pageNo, perPage: size }) => {
      try {
        const products = await new ProductService().getProductsPaginated(pageNo ?? 1, size ?? 20, {
          search,
          categoryId,
          status: includeArchived ? 'all' : 'active',
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
            ...(p.archivedAt && { archived: true }),
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
      'assigned automatically. Idempotent: a product with the same name (case-insensitive) ' +
      'or the same barcode is returned instead of a duplicate.',
    {
      displayName: z.string().min(1).max(PRODUCT_NAME_MAX).describe('Name shown in the shop'),
      description: z.string().max(PRODUCT_DESCRIPTION_MAX).optional().describe('Short description'),
      categoryId: z.number().int().positive().describe('Category (list_categories)'),
      barcode: z.string().max(PRODUCT_BARCODE_MAX).optional().describe('EAN barcode'),
      allergens: z
        .array(z.string().min(1))
        .optional()
        .describe('Allergen names as list_catalog_products shows them, e.g. ["Lepek","Mléko"]'),
      groupId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Purchase group (list_product_groups) — interchangeable products'),
    },
    idempotentWrite('Create product'),
    async ({ displayName, description, categoryId, barcode, allergens, groupId }) => {
      try {
        const name = displayName.trim()
        const code = barcode?.trim() || null
        if (!name) return failWithCode('VALIDATION', 'displayName must not be blank')

        // Exact match, not ILIKE — "_" and "%" in a name are no wildcards here.
        const byName = await Product.query()
          .whereRaw('LOWER(display_name) = LOWER(?)', [name])
          .first()
        const existing = byName ?? (code ? await Product.findBy('barcode', code) : null)
        if (existing) {
          return ok({
            productId: existing.id,
            keypadId: existing.keypadId,
            displayName: existing.displayName,
            existed: true,
            matchedBy: byName ? 'name' : 'barcode',
            hint: 'A product with this name or barcode already exists — returning it instead of creating a duplicate.',
          })
        }
        if (!(await Category.find(categoryId))) {
          return failWithCode('CATEGORY_NOT_FOUND', 'Creating product failed')
        }
        if (groupId && !(await ProductGroup.find(groupId))) {
          return failWithCode('GROUP_NOT_FOUND', 'Creating product failed')
        }
        const allergenIds = allergens?.length ? await allergenIdsByName(allergens) : { ids: [] }
        if ('error' in allergenIds) return allergenIds.error

        const product = await withProductKeypadId(async (trx, nextKeypadId) => {
          const created = await Product.create(
            {
              keypadId: nextKeypadId,
              displayName: name,
              description: description ?? '',
              categoryId,
              barcode: code,
              productGroupId: groupId ?? null,
            },
            { client: trx }
          )
          if (allergenIds.ids.length > 0) {
            await created.related('allergens').attach(allergenIds.ids, trx)
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
          hint: 'Created without an image — add one in the web UI. Stock it with add_stock or a draft.',
        })
      } catch (err) {
        if (isUniqueViolation(err, 'barcode')) {
          return failWithCode('BARCODE_TAKEN', 'Creating product failed')
        }
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
      allergens: z
        .array(z.string().min(1))
        .optional()
        .describe('The complete list of allergen names; [] clears them'),
      groupId: z
        .number()
        .int()
        .positive()
        .nullable()
        .optional()
        .describe('Purchase group (list_product_groups); null removes the product from it'),
    },
    idempotentWrite('Update product'),
    async ({ productId, displayName, description, categoryId, barcode, allergens, groupId }) => {
      try {
        const service = new ProductService()
        const product = await Product.find(productId)
        if (!product) return failWithCode('PRODUCT_NOT_FOUND', 'Updating product failed')
        if (displayName !== undefined && !displayName.trim()) {
          return failWithCode('VALIDATION', 'displayName must not be blank')
        }
        if (categoryId !== undefined && !(await Category.find(categoryId))) {
          return failWithCode('CATEGORY_NOT_FOUND', 'Updating product failed')
        }
        if (groupId !== undefined && groupId !== null && !(await ProductGroup.find(groupId))) {
          return failWithCode('GROUP_NOT_FOUND', 'Updating product failed')
        }
        const allergenIds = allergens === undefined ? null : await allergenIdsByName(allergens)
        if (allergenIds && 'error' in allergenIds) return allergenIds.error
        const before = await service.getProduct(productId)

        if (displayName !== undefined) product.displayName = displayName.trim()
        if (description !== undefined) product.description = description
        if (categoryId !== undefined) product.categoryId = categoryId
        if (barcode !== undefined) product.barcode = barcode?.trim() || null
        if (groupId !== undefined) product.productGroupId = groupId
        await product.save()

        if (allergenIds) {
          await product.related('allergens').sync(allergenIds.ids)
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
          hint: Object.keys(changes).length
            ? undefined
            : 'Nothing changed — the values were already set.',
        })
      } catch (err) {
        if (isUniqueViolation(err, 'barcode')) {
          return failWithCode('BARCODE_TAKEN', 'Updating product failed')
        }
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
        const own = summary.find((row) => row.buyerId === user.id)
        return ok({
          buyers: summary.map((row) => (row.buyerId === user.id ? { ...row, isSelf: true } : row)),
          totalUninvoiced: summary
            .filter((row) => row.buyerId !== user.id)
            .reduce((sum, row) => sum + row.totalCost, 0),
          ownConsumption: own?.totalCost ?? 0,
          hint:
            'CZK. totalUninvoiced is what others owe; isSelf = your own purchases ' +
            '(ownConsumption), invoiced as paid and nobody is e-mailed. Confirm the buyers and ' +
            'the total with the user, then generate_invoices with expectedTotal.',
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
      'e-mails the buyers and cannot be undone: call uninvoiced_summary first, confirm the ' +
      'buyers and the total with the user and pass that total as expectedTotal. Buyers pay by ' +
      'bank transfer; confirm their payments with approve_payment.',
    {
      buyerId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Only invoice this buyer (see uninvoiced_summary)'),
      expectedTotal: z
        .number()
        .min(0)
        .optional()
        .describe(
          "The total the user approved: totalUninvoiced, or that buyer's totalCost with " +
            'buyerId. If purchases changed since, nothing is issued (TOTAL_CHANGED).'
        ),
    },
    destructive('Generate invoices'),
    async ({ buyerId, expectedTotal }) => {
      try {
        const invoiceService = new InvoiceService()
        const invoices = buyerId
          ? [await invoiceService.generateInvoiceForBuyer(user.id, buyerId, { expectedTotal })]
          : await invoiceService.generateInvoices(user.id, { expectedTotal })
        const issued = invoices.filter((inv): inv is Invoice => inv !== null)
        const emailed = issued.filter((inv) => inv.buyerId !== user.id).length
        return ok({
          invoices: issued.map((inv) => ({
            invoiceId: inv.id,
            buyerId: inv.buyerId,
            totalCost: inv.totalCost,
            ...(inv.buyerId === user.id && { isSelf: true, status: 'paid' }),
          })),
          hint:
            issued.length === 0
              ? 'No uninvoiced orders found.'
              : `${issued.length} invoice(s) issued; ${emailed} buyer(s) e-mailed with the QR payment.`,
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
    'Confirm that the money for an invoice you issued arrived — marks it paid and e-mails ' +
      'the buyer. Usually for status "awaiting" (list_issued_invoices); also for "unpaid" when ' +
      'the money came another way (cash). Admins also settle invoices of a supplier who was ' +
      'disabled or is no longer a supplier (list_all_invoices). To report your own payment of ' +
      'an invoice you received use request_payment.',
    {
      invoiceId: z.number().int().positive().describe('Invoice you issued'),
    },
    destructive('Approve payment', true),
    async ({ invoiceId }) => {
      try {
        const invoice = await Invoice.find(invoiceId)
        if (!invoice) return failWithCode('NOT_FOUND', 'Approving payment failed')
        // An admin may settle for an issuer who left (the service checks that).
        const asAdmin = invoice.supplierId !== user.id && user.role === 'admin'
        if (invoice.supplierId !== user.id && !asAdmin) {
          return failWithCode('FORBIDDEN', 'Approving payment failed')
        }
        if (invoice.isPaid) return failWithCode('ALREADY_PAID', 'Approving payment failed')
        await new InvoiceService().approvePayment(invoiceId, user.id, { asAdmin })
        return ok({ invoiceId, status: 'paid', hint: 'Confirmed. The buyer was e-mailed.' })
      } catch (err) {
        return mapDomainError(err, 'Approving payment failed')
      }
    }
  )

  // ── reject_payment ──────────────────────────────────────────────────────────
  server.tool(
    'reject_payment',
    'Reject a payment a buyer reported on an invoice you issued because it did not arrive — ' +
      'the invoice goes back to "unpaid" and the buyer is e-mailed. Only for status ' +
      '"awaiting"; a confirmed payment can only be undone on the web. Admins: also for a ' +
      'supplier who left, like approve_payment.',
    {
      invoiceId: z.number().int().positive().describe('Invoice you issued'),
    },
    destructive('Reject payment'),
    async ({ invoiceId }) => {
      try {
        const invoice = await Invoice.find(invoiceId)
        if (!invoice) return failWithCode('NOT_FOUND', 'Rejecting payment failed')
        const asAdmin = invoice.supplierId !== user.id && user.role === 'admin'
        if (invoice.supplierId !== user.id && !asAdmin) {
          return failWithCode('FORBIDDEN', 'Rejecting payment failed')
        }
        if (invoice.isPaid) {
          return failWithCode('PAYMENT_ALREADY_CONFIRMED', 'Rejecting payment failed')
        }
        if (!invoice.isPaymentRequested) {
          return failWithCode('NOTHING_TO_REJECT', 'Rejecting payment failed')
        }
        await new InvoiceService().rejectPayment(invoiceId, user.id, { asAdmin })
        return ok({ invoiceId, status: 'unpaid', hint: 'Rejected. The buyer was e-mailed.' })
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
          hint:
            'quantity = pieces to buy; unitCost = expected purchase price per piece (CZK, 2 ' +
            'decimals); costSource "selling" means no purchase price was recorded yet — ' +
            'unitCost is then the usual selling price. goodPrice = worth stocking up at or ' +
            'below it. Empty fields (null, false, []) are left out of lines. Change a line ' +
            'with update_shopping_list_line, add one with add_shopping_list_line, finish the ' +
            'trip with complete_shopping_list, or edit on the web: ' +
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
          hint: line
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
        return ok({ key, line: await findLine(user, key), hint: 'Added to the saved list.' })
      } catch (err) {
        return mapDomainError(err, 'Adding the shopping-list line failed')
      }
    }
  )

  // ── complete_shopping_list ────────────────────────────────────────────────────
  server.tool(
    'complete_shopping_list',
    'After a shopping trip: adds the ticked lines (or all lines when none is ticked) to your ' +
      'one open stocking draft (created when there is none) and closes the list, so the next ' +
      'trip starts fresh. Nothing is stocked. ' +
      'Then fill in what the receipt says with update_stock_draft (lines by index) — do not ' +
      'start a second draft with create_stock_draft.',
    {},
    additiveWrite('Finish the shopping trip'),
    async () => {
      try {
        const i18n = i18nManager.locale(i18nManager.defaultLocale)
        const date = DateTime.now().setZone(FRIDGE_TIMEZONE).toFormat('d. M. yyyy')
        const completed = await new ShoppingListService().completeIntoDraft(user, {
          note: i18n.t('shopping.draft_note_from_list', { date }),
          extrasNote: (items) => i18n.t('shopping.draft_note_extras', { items }),
          moreExtras: (count) => i18n.t('shopping.draft_note_more', { count }),
        })
        const draft = await new StockDraftService().get(user, completed.draft.id)
        return ok({
          ...(await describeDraft(draft)),
          added: completed.lines,
          freeTextLines: completed.extras,
          hint:
            `The list is closed and its ${completed.lines} line(s) were added to your open ` +
            'draft (lines with source "shopping_list"; lines already there stay) — nothing is ' +
            'stocked. ' +
            'Fix lines from the receipt with update_stock_draft(lines), pick products for ' +
            'group lines from groupProducts, then let the supplier stock it at reviewUrl.',
        })
      } catch (err) {
        return mapDomainError(err, 'Finishing the shopping list failed')
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
        // Exact match like the unique index on LOWER(name) — "_" and "%" are no wildcards.
        const existing = await ProductGroup.query()
          .whereRaw('LOWER(name) = LOWER(?)', [name.trim()])
          .first()
        if (existing) {
          const ignored = [
            ...(categoryId !== existing.categoryId ? ['categoryId'] : []),
            ...(note !== undefined && (note.trim() || null) !== existing.note ? ['note'] : []),
          ]
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
            ...(ignored.length && { ignored }),
            hint:
              (added.length
                ? 'The group existed — the listed products were added to it.'
                : 'The group existed — nothing changed.') +
              (ignored.length ? ' Its category and note stay; change them on the web.' : ''),
          })
        }

        const group = await service.create(user.id, {
          name: name.trim(),
          categoryId,
          note,
          productIds,
        })
        const members = await Product.query().where('productGroupId', group.id).select('id')
        return ok({
          groupId: group.id,
          name: group.name,
          existed: false,
          addedProductIds: members.map((p) => p.id),
          productIds: members.map((p) => p.id),
          hint: 'Group created. The shopping list plans its members as one line.',
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
      'for several products, or whenever a product match or a price is uncertain. A supplier ' +
      'has ONE open draft: the lines are added to it (it is created when there is none), next ' +
      'to lines from the web or the shopping list — each line says its source. Nothing is ' +
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
        const appended = await service.appendLines(
          user.id,
          { source: 'mcp', note: note ?? null, items: toDraftInput(items) },
          { strict: true }
        )
        const draft = await service.get(user, appended.draft.id)
        const described = await describeDraft(draft)
        return ok({
          ...described,
          added: appended.added,
          created: appended.created,
          hint:
            (appended.created
              ? 'A new draft was started with these lines. '
              : `Added ${appended.added} line(s) to the open draft, which now has ` +
                `${described.lines} — the earlier lines (see items[].source) stay. `) +
            'Nothing is stocked yet. Ask the supplier to open reviewUrl, pick products for ' +
            'unmatched lines, check prices and press "Naskladnit" (Stock) — or fix lines here ' +
            'with update_stock_draft.',
        })
      } catch (err) {
        if (err instanceof StockDraftUnknownReference) return unknownReference(err)
        return mapDomainError(err, 'Creating the stocking draft failed')
      }
    }
  )

  // ── list_stock_drafts ───────────────────────────────────────────────────────
  server.tool(
    'list_stock_drafts',
    'Your stocking drafts. status "open" (default) = the one draft prepared and not stocked ' +
      'yet (or none): note, lines, pieces, unmatched lines. status "committed" = drafts stocked in the last ' +
      '30 days (voided ones too), newest first, with the purchase total and canVoid — the ' +
      'draftId for void_stock_draft. get_stock_draft shows the lines of one; single lots are ' +
      'in recent_deliveries.',
    {
      status: z
        .enum(['open', 'committed'])
        .optional()
        .describe('"open" (default) or "committed" (stocked, last 30 days)'),
      page: page(),
      perPage: perPage(),
    },
    readOnly('Stocking drafts'),
    async ({ status, page: pageNo, perPage: size }) => {
      try {
        const service = new StockDraftService()
        if (status === 'committed') {
          const stocked = await service.listStocked(user.id, pageNo ?? 1, size ?? 20)
          return ok({
            status: 'committed',
            meta: stocked.meta,
            drafts: stocked.data.map((d) =>
              withoutEmpty({
                draftId: d.id,
                status: d.status,
                source: d.source,
                note: d.note,
                committedAt: d.committedAt,
                voidedAt: d.voidedAt,
                lines: d.lines,
                pieces: d.pieces,
                purchaseTotal: d.purchaseTotal,
                linesWithoutPurchase: d.linesWithoutPurchase,
                canVoid: d.canVoid,
                reviewUrl: webUrl(`/supplier/stock/drafts/${d.id}`),
              })
            ),
            hint:
              'status "voided" = taken back with void_stock_draft. canVoid = nothing of it sold ' +
              'or was written off yet, so void_stock_draft can still take it back. Empty fields ' +
              'are left out.',
          })
        }
        const drafts = await service.listOpen(user.id)
        return ok({
          status: 'open',
          // A supplier has at most one open draft.
          drafts: drafts.slice(0, 1).map((d) => ({
            draftId: d.id,
            note: d.note,
            createdAt: d.createdAt,
            lines: d.lines,
            pieces: d.pieces,
            unmatched: d.unmatched,
            isEmpty: d.isEmpty,
            reviewUrl: webUrl(`/supplier/stock/drafts/${d.id}`),
          })),
          hint:
            drafts.length === 0
              ? 'No open draft — create_stock_draft starts one.'
              : 'Your one open draft. get_stock_draft shows its lines and where each came from ' +
                '(source "web" = by hand, "shopping_list" = a finished shopping list, ' +
                '"assistant" = an AI assistant).',
        })
      } catch (err) {
        return mapDomainError(err, 'Listing stocking drafts failed')
      }
    }
  )

  // ── void_stock_draft ────────────────────────────────────────────────────────
  server.tool(
    'void_stock_draft',
    'Take back a whole stocked draft — a receipt stocked twice, goods that never reached the ' +
      'fridge: every lot of it is voided at once. Only while nothing of it sold or was written ' +
      'off (canVoid in list_stock_drafts(status: "committed")); otherwise fix single lots with ' +
      'correct_delivery. Ask the user first.',
    {
      draftId: z.number().int().positive().describe('Stocked draft (list_stock_drafts)'),
      reason: z
        .string()
        .min(CORRECTION_REASON_MIN_LENGTH)
        .max(CORRECTION_REASON_MAX_LENGTH)
        .describe('Why, e.g. "the receipt was stocked twice"'),
    },
    destructive('Void a stocked draft', true),
    async ({ draftId, reason }) => {
      try {
        const result = await new StockDraftService().voidStocked(user, draftId, reason)
        return ok({
          draftId,
          status: 'voided',
          voidedDeliveries: result.voidedDeliveries,
          hint: 'Voided. Its lots left the stock; the history keeps them as voided.',
        })
      } catch (err) {
        return mapDomainError(err, 'Voiding the stocked draft failed')
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
    'Change the lines of an open draft — e.g. after the supplier told you which product an ' +
      'unmatched line is. Fix a few lines with lines (by index from get_stock_draft; only the ' +
      'fields you pass change). Send items only to rewrite the whole draft: then lines you ' +
      'leave out are removed — also lines from the web or the shopping list; to add a receipt ' +
      'use create_stock_draft. Nothing is stocked. For a draft that was already stocked use ' +
      'correct_delivery on its lots.',
    {
      draftId: z.number().int().positive().describe('Open draft (list_stock_drafts)'),
      note: z
        .string()
        .max(STOCK_DRAFT_NOTE_MAX)
        .nullable()
        .optional()
        .describe('New note; null clears it; omit to keep it'),
      lines: z
        .array(draftLinePatchSchema)
        .min(1)
        .max(STOCK_DRAFT_MAX_ITEMS)
        .optional()
        .describe('Changes to single lines, by index — the usual way'),
      items: z
        .array(draftItemSchema)
        .min(1)
        .max(STOCK_DRAFT_MAX_ITEMS)
        .optional()
        .describe('The complete new list of lines — replaces all of them'),
    },
    idempotentWrite('Update stocking draft'),
    async ({ draftId, note, lines, items }) => {
      try {
        if ((lines === undefined) === (items === undefined)) {
          return failWithCode(
            'VALIDATION',
            'Pass either lines (fix single lines by index) or items (the whole list), not both'
          )
        }
        const service = new StockDraftService()
        let next: StockDraftItemInput[]
        if (items) {
          const unnamed = unnamedLine(items)
          if (unnamed !== -1) {
            return failWithCode('VALIDATION', `Line ${unnamed} needs a productId or a label`)
          }
          next = toDraftInput(items)
        } else {
          const current = await service.get(user, draftId)
          const patched = applyLinePatches(current.items, lines!)
          if ('error' in patched) return patched.error
          next = patched.items
        }
        const draft = await service.update(user, draftId, { note, items: next }, { strict: true })
        const described = await describeDraft(draft)
        return ok({
          ...described,
          hint:
            described.problems.length === 0
              ? 'Saved. Every line is complete — the supplier can stock it on the web, or commit_stock_draft once they said so.'
              : 'Saved. Lines in problems still need a product or a price before stocking.',
        })
      } catch (err) {
        if (err instanceof StockDraftUnknownReference) return unknownReference(err)
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
          hint: 'Discarded. Nothing in the stock changed.',
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
      "line without a selling price gets purchasePrice plus the supplier's margin, never below " +
      "the product's current price. Warnings (a duplicate, an unusual price, a purchase price " +
      'that is only an estimate) stop it until confirmed. The lots sell immediately.',
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
          hint: 'Stocked. Customers can buy from these lots now; void_delivery undoes a lot while nothing sold.',
        })
      } catch (err) {
        if (err instanceof StockDraftNeedsConfirmation) {
          return ok({
            draftId,
            stocked: false,
            warnings: err.warnings,
            hint:
              'Nothing stocked. duplicate = a lot of this product was stocked minutes ago (a ' +
              'double submit?); unusualPrice = the price is far from the last lot; ' +
              'unusualPurchasePrice = far from what was paid last time; ' +
              "estimatedPurchasePrice = the purchase price is the shopping list's estimate, " +
              'not a receipt (fix it with update_stock_draft, or confirm it). price = what the ' +
              'line would sell for. Show this to the user and call again with confirmWarnings: ' +
              'true only if they confirm.',
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
      "(as a sale would) and count as shrinkage in get_finance_summary. Every supplier's lots " +
      "of the product count, so a write-off may land on a colleague's lot (lots[].supplier; " +
      'they see it in their history). Cannot be undone. For a shelf count that finds an ' +
      'unexplained difference use record_inventory_count instead.',
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
        const suppliers = await db
          .from('users')
          .whereIn('id', [...new Set(adjustments.map((a) => a.supplierId))])
          .select('id', 'display_name')
        const supplierNames = new Map(suppliers.map((u) => [Number(u.id), String(u.display_name)]))
        return ok({
          productId,
          product: product.displayName,
          quantity,
          reason,
          lots: adjustments.map((a) => ({
            deliveryId: a.deliveryId,
            quantity: a.quantity,
            supplier: supplierNames.get(a.supplierId) ?? null,
          })),
          hint: 'Recorded as shrinkage — see get_finance_summary → shrinkage.byReason.',
        })
      } catch (err) {
        return mapDomainError(err, 'Writing off stock failed')
      }
    }
  )

  // ── revert_write_off ────────────────────────────────────────────────────────
  server.tool(
    'revert_write_off',
    'Take back a manual write-off recorded by mistake — the pieces return to the same lot ' +
      'and stop counting as shrinkage. Within 7 days, by whoever recorded it (admins: any). ' +
      'adjustmentId comes from list_stock_adjustments (revertible: true). An inventory ' +
      'difference cannot be reverted.',
    {
      adjustmentId: z
        .number()
        .int()
        .positive()
        .describe('Write-off to take back (list_stock_adjustments)'),
    },
    destructive('Revert write-off', true),
    async ({ adjustmentId }) => {
      try {
        const reverted = await new InventoryService().revertWriteOff(user, adjustmentId)
        const names = await productNames([reverted.productId])
        return ok({
          adjustmentId: reverted.id,
          productId: reverted.productId,
          product: names.get(reverted.productId) ?? null,
          quantity: reverted.quantity,
          deliveryId: reverted.deliveryId,
          revertedAt: reverted.revertedAt?.toISO() ?? null,
          hint: 'Reverted. The pieces are back in stock and no longer count as shrinkage.',
        })
      } catch (err) {
        return mapDomainError(err, 'Reverting the write-off failed')
      }
    }
  )

  // ── void_delivery ───────────────────────────────────────────────────────────
  server.tool(
    'void_delivery',
    'Cancel a delivery lot nothing was sold from yet — a duplicate or a mistaken add_stock. ' +
      'The lot leaves the stock; the row stays in the history. Only your own lots (admins: ' +
      'any). Find deliveryId with recent_deliveries. If something already sold from the lot, ' +
      'lower its pieces with correct_delivery instead.',
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
          hint: 'The lot is out of the stock. The history keeps the row as voided.',
        })
      } catch (err) {
        return mapDomainError(err, 'Voiding the delivery failed')
      }
    }
  )

  // ── correct_delivery ────────────────────────────────────────────────────────
  server.tool(
    'correct_delivery',
    'Fix the pieces, the selling price or the purchase price of a lot after stocking. Pass ' +
      'only what changes. Pieces can only go down and never below what sold; a new selling ' +
      'price applies to the remaining pieces and to purchases from this lot not invoiced yet ' +
      '(issued invoices never change; those buyers are e-mailed). Only your own lots (admins: ' +
      'any). For a lot nothing sold from use void_delivery.',
    {
      deliveryId: z.number().int().positive().describe('Lot to correct (recent_deliveries)'),
      amount: z
        .number()
        .int()
        .min(1)
        .max(DELIVERY_MAX_AMOUNT)
        .optional()
        .describe('New total pieces of the lot; omit to keep them'),
      price: z
        .number()
        .int()
        .min(1)
        .max(DELIVERY_MAX_PRICE)
        .optional()
        .describe('New selling price per piece, whole CZK; omit to keep it'),
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
        if (amount === undefined && price === undefined && purchasePrice === undefined) {
          return failWithCode(
            'VALIDATION',
            'Pass at least one of amount, price or purchasePrice — only what changes'
          )
        }
        // The service takes the whole lot; what the agent left out stays as it is.
        const current = await Delivery.find(deliveryId)
        if (!current) return failWithCode('DELIVERY_NOT_FOUND', 'Correcting the delivery failed')
        const { delivery, correction, repricedOrderIds } =
          await new DeliveryService().correctDelivery(user, deliveryId, {
            amount: amount ?? current.amountSupplied,
            price: price ?? current.price,
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
          hint:
            repricedOrderIds.length > 0
              ? `${repricedOrderIds.length} uninvoiced purchase(s) from this lot now carry the new price; their buyers were e-mailed.`
              : 'Corrected. No uninvoiced purchase was repriced.',
        })
      } catch (err) {
        return mapDomainError(err, 'Correcting the delivery failed')
      }
    }
  )

  // ── reprice_stock ───────────────────────────────────────────────────────────
  server.tool(
    'reprice_stock',
    'Change the selling price of pieces still in stock — a sale or a price rise. Sold pieces ' +
      'keep their price and no buyer is e-mailed. Without lots: every lot of yours of the ' +
      'product gets `price` (admins too: only their own). With lots: exactly those lots get ' +
      "their own price — admins may pass a colleague's lot, who is then e-mailed. Lot ids and " +
      'prices come from list_stock_lots. For a mistyped price of one lot (also fixing ' +
      'purchases not invoiced yet) use correct_delivery.',
    {
      productId: z.number().int().positive().describe('Product (get_stock)'),
      price: z
        .number()
        .int()
        .min(1)
        .max(DELIVERY_MAX_PRICE)
        .optional()
        .describe('New selling price per piece for all your lots, whole CZK (without lots)'),
      lots: z
        .array(
          z.object({
            deliveryId: z.number().int().positive(),
            price: z.number().int().min(1).max(DELIVERY_MAX_PRICE),
          })
        )
        .min(1)
        .max(REPRICE_MAX_LOTS)
        .optional()
        .describe('Exact lots of this product with their new price (list_stock_lots)'),
    },
    destructive('Reprice remaining stock', true),
    async ({ productId, price, lots }) => {
      try {
        const product = await Product.find(productId)
        if (!product) return failWithCode('PRODUCT_NOT_FOUND', 'Repricing failed')
        const service = new DeliveryService()
        let result
        if (lots) {
          const own = await Delivery.query()
            .whereIn(
              'id',
              lots.map((lot) => lot.deliveryId)
            )
            .where('productId', productId)
            .select('id')
          // A lot of another product would be repriced under the wrong name.
          if (own.length !== new Set(lots.map((lot) => lot.deliveryId)).size) {
            return failWithCode('DELIVERY_NOT_FOUND', 'Repricing failed')
          }
          result = await service.repriceLots(user, lots)
        } else if (price !== undefined) {
          result = await service.repriceRemaining(user, productId, price)
        } else {
          return failWithCode('VALIDATION', 'Pass price (all your lots) or lots (exact ones)')
        }
        return ok({
          productId,
          product: product.displayName,
          pieces: result.pieces,
          lots: result.lots.map((lot) => ({
            deliveryId: lot.deliveryId,
            mine: lot.supplierId === user.id,
            from: lot.from,
            to: lot.to,
            pieces: lot.pieces,
          })),
          hint:
            `${result.pieces} piece(s) in stock on ${result.lots.length} lot(s) now sell at the ` +
            'new price. Sold pieces keep theirs; owners of colleagues’ lots were e-mailed.',
        })
      } catch (err) {
        return mapDomainError(err, 'Repricing failed')
      }
    }
  )

  // ── list_stock_lots ─────────────────────────────────────────────────────────
  server.tool(
    'list_stock_lots',
    'The lots of one product with pieces left, in the order they sell and are written off ' +
      '(oldest first, every supplier): deliveryId, date, supplier, pieces left, selling price, ' +
      'whether it is yours and whether you may reprice it. No purchase prices.',
    { productId: z.number().int().positive().describe('Product (get_stock)') },
    readOnly('Stock lots of a product'),
    async ({ productId }) => {
      try {
        const lots = await new DeliveryService().listLotsInStock(user, productId)
        return ok({
          productId,
          lots: lots.map((lot) => ({
            deliveryId: lot.deliveryId,
            createdAt: lot.createdAt,
            supplier: lot.supplier.name,
            amountLeft: lot.amountLeft,
            price: lot.price,
            mine: lot.mine,
            editable: lot.editable,
          })),
          note: 'The first lot sells (and is written off) first.',
        })
      } catch (err) {
        return mapDomainError(err, 'Listing the lots failed')
      }
    }
  )

  // ── record_inventory_count ──────────────────────────────────────────────────
  server.tool(
    'record_inventory_count',
    'Save a shelf count the user dictates: for each product the pieces counted. The server ' +
      "compares them with the current stock of the whole fridge — every supplier's lots. " +
      'Missing pieces are written off the oldest lots without a reason (give one later with ' +
      'classify_inventory_loss); extra pieces go back onto the newest lot. Only the products ' +
      'you pass are touched. When you already know why pieces are missing use write_off_stock.',
    {
      scope: z
        .enum(INVENTORY_SCOPES)
        .optional()
        .describe(
          'Label for the history only (default "all"); every lot of the counted products is ' +
            'adjusted, whoever stocked it'
        ),
      note: z.string().max(ADJUSTMENT_NOTE_MAX).optional().describe('Shown on the count'),
      items: z
        .array(
          z.object({
            productId: z.number().int().positive(),
            counted: z.number().int().min(0).describe('Pieces on the shelf'),
            expected: z
              .number()
              .int()
              .min(0)
              .optional()
              .describe(
                'Omit it — the server uses the current stock. Only for a count taken earlier ' +
                  '(a printed sheet): the stock then, from get_stock with scope "all"'
              ),
          })
        )
        .min(1)
        .max(INVENTORY_MAX_ITEMS),
    },
    destructive('Record inventory count'),
    async ({ scope, note, items }) => {
      try {
        const service = new InventoryService()
        // Without expected the service compares with the whole fridge's stock under the lot
        // locks — the shelf was counted just now, so "now" is the snapshot.
        const created = await service.commitCount(user, {
          scope: scope ?? 'all',
          note: note ?? null,
          items,
        })
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
          hint:
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
      'from record_inventory_count, or from list_stock_adjustments for an older count. Only a ' +
      'shortfall gets a reason; for pieces you lose outside a count use write_off_stock.',
    {
      countId: z
        .number()
        .int()
        .positive()
        .describe('Inventory count (record_inventory_count, list_stock_adjustments)'),
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
          hint: result.changed
            ? 'Saved. get_finance_summary → shrinkage.byReason reflects it.'
            : 'The missing pieces already had this reason — nothing changed.',
        })
      } catch (err) {
        return mapDomainError(err, 'Classifying the inventory loss failed')
      }
    }
  )

  // ── list_stock_adjustments ──────────────────────────────────────────────────
  server.tool(
    'list_stock_adjustments',
    'Past write-offs and inventory differences, newest first — what was lost, when, why and ' +
      'by whom. Inventory rows carry the countId for classify_inventory_loss (reason ' +
      '"inventory" = not explained yet). For stocked lots use recent_deliveries.',
    {
      origin: z
        .enum(['write_off', 'inventory'])
        .optional()
        .describe('"write_off" = recorded with a reason, "inventory" = found by a count'),
      reason: z
        .enum(['inventory', ...WRITE_OFF_REASONS])
        .optional()
        .describe('Only losses with this reason ("inventory" = unexplained count shortfall)'),
      productId: z.number().int().positive().optional().describe('Only this product'),
      scope: z
        .enum(['mine', 'all'])
        .optional()
        .describe('"mine" = losses on your lots (default), "all" = the whole fridge'),
      page: page(),
      perPage: perPage(),
    },
    readOnly('Write-offs and count differences'),
    async ({ origin, reason, productId, scope, page: pageNo, perPage: size }) => {
      try {
        const list = await new StockHistoryService().listAdjustments(
          user,
          pageNo ?? 1,
          size ?? 20,
          { scope: scope ?? 'mine', productId, reason, origin }
        )
        return ok({
          scope: scope ?? 'mine',
          meta: list.meta,
          adjustments: list.data.map((row) =>
            withoutEmpty({
              id: row.id,
              createdAt: row.createdAt,
              productId: row.productId,
              product: row.productName,
              kind: row.kind,
              quantity: row.quantity,
              reason: row.reason,
              countId: row.inventoryCountId,
              note: row.note,
              lotSupplier: row.lotSupplierName,
              actor: row.actorName,
              revertedAt: row.revertedAt,
              revertible: row.revertible,
            })
          ),
          hint:
            'kind "loss" = pieces gone, "surplus" = pieces a count found. countId is set for ' +
            'inventory rows; give an unexplained loss a reason with classify_inventory_loss. ' +
            'revertedAt = taken back (no longer shrinkage); revertible = revert_write_off can ' +
            'take it back now. Empty fields are left out.',
        })
      } catch (err) {
        return mapDomainError(err, 'Listing the write-offs failed')
      }
    }
  )

  // ── get_finance_summary ─────────────────────────────────────────────────────
  server.tool(
    'get_finance_summary',
    'Your earnings for one calendar year (default: this year): sales to other people, their ' +
      'purchase cost and gross profit, own consumption (your purchases from your own lots — ' +
      'not income), shrinkage by reason, net profit, the margin that just covers the ' +
      'shrinkage, money (purchased this year, stock at purchase prices, still owed to you) and ' +
      'the yearly income limit if the instance sets one — counted by payment date: ' +
      'incomeLimit.amount = money received, pending = still owed; not tax advice. byProduct: true adds ' +
      'the per-product breakdown — "what earns most / what loses money". lossRate is a ' +
      'fraction 0–1; *Percent fields are percentages.',
    {
      year: z.number().int().min(2000).max(2100).optional().describe('Default: this year'),
      byProduct: z.boolean().optional().describe('Add the per-product breakdown (paginated)'),
      sortBy: z
        .enum(['grossProfit', 'revenue', 'lostUnits'])
        .optional()
        .describe('Breakdown order, highest first (default revenue)'),
      page: page(),
      perPage: perPage(),
    },
    readOnly('Finance summary'),
    async ({ year, byProduct, sortBy, page: pageNo, perPage: size }) => {
      try {
        const service = new FinanceService()
        const selectedYear = year ?? service.currentYear()
        const summary = await service.getSummary(
          user.id,
          selectedYear,
          Number(user.marginPercent ?? 0)
        )
        const breakdown = byProduct
          ? await service.getProductBreakdown(user.id, selectedYear, pageNo ?? 1, size ?? 20, {
              sortBy: sortBy ?? 'revenue',
              sortOrder: 'desc',
            })
          : null
        return ok({
          ...summary,
          ...(breakdown && { products: breakdown.data, productsMeta: breakdown.meta }),
          hint:
            'Money in CZK. lossRate is a fraction 0–1; achievedMarginPercent, ' +
            'breakEvenMarginPercent, marginPercent and incomeLimit.percent are percentages. ' +
            'lossCost values all shrinkage at purchase prices (selling prices where none was ' +
            'recorded), lossValue at selling prices. netProfit subtracts only the shrinkage of ' +
            'lots with a purchase price and is null while no sale has one.' +
            ' incomeLimit counts by payment date: amount = received this year, pending = ' +
            'still owed (null for past years); not tax advice. money.stockAtCost leaves out ' +
            'stockUnitsWithoutCost pieces.' +
            (breakdown ? ' products[].grossProfit is null without any purchase price.' : '') +
            ' Full report: ' +
            webUrl('/supplier/finance'),
        })
      } catch (err) {
        return mapDomainError(err, 'Computing the finance summary failed')
      }
    }
  )
}
