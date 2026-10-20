import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import StockDraft, { type StockDraftSource } from '#models/stock_draft'
import StockDraftItem, { type StockDraftLineSource } from '#models/stock_draft_item'
import Product from '#models/product'
import ProductGroup from '#models/product_group'
import type Delivery from '#models/delivery'
import type User from '#models/user'
import DeliveryService, {
  type DeliveryCorrectionResult,
  type StockWarnings,
} from '#services/delivery_service'
import NotificationService from '#services/notification_service'
import AuditService from '#services/audit_service'
import { runAfterResponse } from '#services/side_effects'
import { DomainError } from '#services/domain_error'
import { roundMoney, suggestDraftPrice } from '#services/shopping/pricing'

export type StockDraftErrorCode =
  | 'DRAFT_NOT_FOUND'
  | 'DRAFT_CLOSED'
  | 'DRAFT_EMPTY'
  | 'DRAFT_INCOMPLETE'
  | 'DRAFT_STALE'
  | 'PRODUCT_NOT_FOUND'
  | 'GROUP_NOT_FOUND'
  | 'DRAFT_NOT_COMMITTED'
  | 'DRAFT_VOIDED'
  | 'DRAFT_HAS_SALES'
  | 'DRAFT_TRANSFERRED'

/** How far back the "Naskladněné" history of stocked drafts goes. */
export const STOCKED_HISTORY_DAYS = 30
/** Empty open drafts older than this are discarded by the nightly clean-up. */
export const EMPTY_DRAFT_TTL_DAYS = 7
/** First half of the `pg_advisory_xact_lock(int, int)` key; the second is the supplier id. */
const CURRENT_DRAFT_LOCK = 0x5bf1d

export interface StockDraftItemInput {
  productId?: number | null
  productGroupId?: number | null
  label?: string | null
  amount: number
  purchasePrice?: number | null
  /** The purchase price is an estimate, not read from a receipt (shopping-list lines). */
  purchasePriceEstimated?: boolean
  /** Who put the line on the draft; a new line takes it from the caller, a saved one keeps it. */
  source?: StockDraftLineSource
  price?: number | null
}

type DraftActor = Pick<User, 'id' | 'role' | 'marginPercent'>

/** Lines with a problem the supplier has to fix before the draft can be stocked. */
export interface DraftProblem {
  index: number
  problem: 'product' | 'price'
}

/** A line the supplier should look at once more before it is stocked. */
export interface DraftCommitWarning extends StockWarnings {
  index: number
  productId: number
  productName: string
  /** The selling price the line will be stocked at. */
  price: number
  /** Its purchase price is still the shopping list's estimate. */
  estimatedPurchasePrice: boolean
}

const NO_STOCK_WARNINGS: StockWarnings = {
  duplicate: null,
  unusualPrice: null,
  unusualPurchasePrice: null,
}

/**
 * Thrown (only when asked for with `strict`) for a line naming a product or a group that does
 * not exist, so an API caller learns which line is wrong instead of finding it unmatched.
 */
export class StockDraftUnknownReference extends DomainError<
  'PRODUCT_NOT_FOUND' | 'GROUP_NOT_FOUND'
> {
  constructor(
    code: 'PRODUCT_NOT_FOUND' | 'GROUP_NOT_FOUND',
    readonly index: number,
    readonly id: number
  ) {
    super(code)
    this.name = 'StockDraftUnknownReference'
  }
}

/**
 * Thrown by `commit` when a line looks like a double submit or has an unusual price and the
 * caller did not pass `confirmWarnings`. The lines are saved; nothing is stocked.
 */
export class StockDraftNeedsConfirmation extends DomainError<'NEEDS_CONFIRMATION'> {
  constructor(readonly warnings: DraftCommitWarning[]) {
    super('NEEDS_CONFIRMATION')
    this.name = 'StockDraftNeedsConfirmation'
  }
}

type SanitizedItem = {
  productId: number | null
  productGroupId: number | null
  label: string | null
  amount: number
  purchasePrice: number | null
  purchasePriceEstimated: boolean
  price: number | null
  source: StockDraftLineSource
}

/** The line source for what started the lines (`mcp` is how drafts name an AI assistant). */
export function lineSource(source: StockDraftSource): StockDraftLineSource {
  return source === 'mcp' ? 'assistant' : source
}

/** A stocked draft in the "Naskladněné" history. */
export interface StockedDraftRow {
  id: number
  supplierId: number
  supplierName: string
  source: StockDraftSource
  status: 'committed' | 'voided'
  note: string | null
  committedAt: string
  voidedAt: string | null
  lines: number
  pieces: number
  /** Σ purchase price × pieces over the lines that have one; null when none has. */
  purchaseTotal: number | null
  /** Lines stocked without a purchase price (the total leaves them out). */
  linesWithoutPurchase: number
  /** Nothing of it was sold, written off or counted yet — it can still be voided as a whole. */
  canVoid: boolean
}

/** Opaque version of a draft for optimistic concurrency: its `updated_at` in milliseconds. */
export function draftVersion(draft: Pick<StockDraft, 'updatedAt'>): number {
  return draft.updatedAt.toMillis()
}

/**
 * Stocking drafts ("příjemky"): lines prepared ahead — by hand on the web, by an AI
 * assistant over MCP (typically from a receipt photo) or by a finished shopping list — and
 * stocked in one go once the supplier has checked them. Committing creates one delivery per
 * line in a single transaction, so a draft is stocked completely or not at all.
 */
export default class StockDraftService {
  /**
   * Adds lines to the supplier's one open draft — creating it when there is none. Whoever
   * prepares stock (the web form, a finished shopping list, an AI assistant) lands in the
   * same draft; each line remembers its `source`. Lines are always appended, even for a
   * product already on the draft: two receipt lines may carry two prices, and the commit
   * still warns about a double. A note is added to the draft's own (once). Pass `client` to
   * do it inside a larger transaction (finishing a shopping list): the lines and the audit
   * entry then roll back with it.
   */
  async appendLines(
    supplierId: number,
    input: { source: StockDraftSource; note?: string | null; items: StockDraftItemInput[] },
    options: { client?: TransactionClientContract; strict?: boolean } = {}
  ): Promise<{ draft: StockDraft; added: number; created: boolean }> {
    const source = lineSource(input.source)
    // Prices a shopping list puts on its lines are estimates from earlier lots.
    const estimated = source === 'shopping_list'
    const items = await this.sanitize(
      input.items.map((item) => ({
        ...item,
        source,
        purchasePriceEstimated: item.purchasePriceEstimated ?? estimated,
      })),
      options.strict
    )
    const run = async (trx: TransactionClientContract) => {
      await this.lockCurrentDraft(supplierId, trx)
      const existing = await this.openDraft(supplierId, trx)
      const draft =
        existing ??
        (await StockDraft.create(
          { supplierId, source: input.source, note: null, status: 'open' },
          { client: trx }
        ))
      const note = input.note?.trim()
      if (note && !(draft.note ?? '').includes(note)) {
        draft.note = (draft.note ? `${draft.note} · ${note}` : note).slice(0, 500)
      }
      const last = await trx
        .from('stock_draft_items')
        .where('stock_draft_id', draft.id)
        .max('sort_order as max')
        .first()
      const start = last?.max === null || last?.max === undefined ? 0 : Number(last.max) + 1
      await this.insertItems(draft.id, items, trx, start)
      await this.touch(draft, trx)

      // An empty draft opened by "Stock" is not worth an entry: its commit is logged.
      if (items.length) {
        await AuditService.log(
          supplierId,
          existing ? 'stock_draft.lines_added' : 'stock_draft.created',
          'stock_draft',
          draft.id,
          null,
          {
            source: input.source,
            lines: items.length,
            pieces: items.reduce((sum, item) => sum + item.amount, 0),
          },
          { client: trx }
        )
      }
      return { draft, added: items.length, created: !existing }
    }
    return options.client ? run(options.client) : db.transaction(run)
  }

  /** `appendLines`, returning the draft (the shopping list and older callers use this). */
  async create(
    supplierId: number,
    input: { source: StockDraftSource; note?: string | null; items: StockDraftItemInput[] },
    options: { client?: TransactionClientContract; strict?: boolean } = {}
  ): Promise<StockDraft> {
    const { draft } = await this.appendLines(supplierId, input, options)
    return draft
  }

  /**
   * The draft "Stock" opens: the supplier's one open draft, or a new empty one. Serialised
   * per supplier (and backed by a unique index), so a double click never opens two.
   */
  async findOrCreateOpenDraft(supplierId: number): Promise<StockDraft> {
    return db.transaction(async (trx) => {
      await this.lockCurrentDraft(supplierId, trx)
      return this.currentDraft(supplierId, trx)
    })
  }

  /**
   * "Stock this product": adds it to the open draft (see `findOrCreateOpenDraft`) with one
   * piece, the supplier's own last purchase price and the product's last selling price (the
   * selling price may be null — the form then suggests one). A product already in the draft
   * is not added twice: its line is returned with `existing: true`, for the form to focus.
   */
  async appendProduct(
    supplierId: number,
    productId: number
  ): Promise<{ draft: StockDraft; item: StockDraftItem; existing: boolean }> {
    const product = await Product.find(productId)
    if (!product) throw new DomainError<StockDraftErrorCode>('PRODUCT_NOT_FOUND')

    return db.transaction(async (trx) => {
      await this.lockCurrentDraft(supplierId, trx)
      const draft = await this.currentDraft(supplierId, trx)
      const existing = await StockDraftItem.query({ client: trx })
        .where('stockDraftId', draft.id)
        .where('productId', productId)
        .orderBy('sortOrder', 'asc')
        .orderBy('id', 'asc')
        .first()
      if (existing) return { draft, item: existing, existing: true }

      const lastPrices = await this.lastPrices(supplierId, [productId], trx)
      const last = lastPrices.get(productId)
      const lastLine = await trx
        .from('stock_draft_items')
        .where('stock_draft_id', draft.id)
        .max('sort_order as max')
        .first()
      const item = await StockDraftItem.create(
        {
          stockDraftId: draft.id,
          productId,
          productGroupId: null,
          label: null,
          amount: 1,
          purchasePrice: last?.purchasePrice ?? null,
          purchasePriceEstimated: false,
          price: last?.price ?? null,
          source: 'web',
          sortOrder:
            lastLine?.max === null || lastLine?.max === undefined ? 0 : Number(lastLine.max) + 1,
        },
        { client: trx }
      )
      await this.touch(draft, trx)
      return { draft, item, existing: false }
    })
  }

  /**
   * Prices to prefill for `productIds`: the selling price of the product's newest lot by
   * anyone (it is on the shelf for all to see), the purchase price only from the supplier's
   * own newest lot — what a colleague paid is their business and not this supplier's cost.
   */
  async lastPrices(
    supplierId: number,
    productIds?: number[],
    client?: TransactionClientContract
  ): Promise<Map<number, { price: number; purchasePrice: number | null }>> {
    if (productIds && productIds.length === 0) return new Map()
    const result = await (client ?? db).rawQuery<{
      rows: Array<{ product_id: number; price: number; purchase_price: string | null }>
    }>(
      `SELECT anyone.product_id, anyone.price, own.purchase_price
         FROM (SELECT DISTINCT ON (product_id) product_id, price
                 FROM deliveries
                WHERE voided_at IS NULL
                  ${productIds ? 'AND product_id = ANY(:productIds)' : ''}
                ORDER BY product_id, created_at DESC, id DESC) anyone
         LEFT JOIN (SELECT DISTINCT ON (product_id) product_id, purchase_price
                      FROM deliveries
                     WHERE voided_at IS NULL
                       AND supplier_id = :supplierId
                       AND purchase_price IS NOT NULL
                       ${productIds ? 'AND product_id = ANY(:productIds)' : ''}
                     ORDER BY product_id, created_at DESC, id DESC) own
           ON own.product_id = anyone.product_id`,
      productIds ? { productIds, supplierId } : { supplierId }
    )
    return new Map(
      result.rows.map((row) => [
        Number(row.product_id),
        {
          price: Number(row.price),
          purchasePrice: row.purchase_price === null ? null : Number(row.purchase_price),
        },
      ])
    )
  }

  /**
   * Discards open drafts that never got a line and were not touched for
   * EMPTY_DRAFT_TTL_DAYS. Nothing is lost, so nothing is audited. Returns how many.
   */
  async discardStaleEmpty(): Promise<number> {
    const cutoff = DateTime.now().minus({ days: EMPTY_DRAFT_TTL_DAYS })
    const result = await db
      .from('stock_drafts')
      .where('status', 'open')
      .where('updated_at', '<', cutoff.toJSDate())
      .whereNotExists((sub) =>
        sub.from('stock_draft_items').whereRaw('stock_draft_items.stock_draft_id = stock_drafts.id')
      )
      .update({ status: 'discarded', updated_at: DateTime.now().toJSDate() })
    return Number(Array.isArray(result) ? result[0] : result)
  }

  /**
   * A product created from a draft line: the line at `lineIndex` (in sort order) gets the
   * product when it has none yet, otherwise the product is appended as a new line. Used by
   * the product form when the supplier came from a draft.
   */
  async setLineProduct(
    actor: Pick<User, 'id' | 'role'>,
    draftId: number,
    lineIndex: number,
    productId: number
  ): Promise<{ draft: StockDraft; item: StockDraftItem }> {
    const product = await Product.find(productId)
    if (!product) throw new DomainError<StockDraftErrorCode>('PRODUCT_NOT_FOUND')

    return db.transaction(async (trx) => {
      const draft = await this.lockOpen(actor, draftId, trx)
      const items = await StockDraftItem.query({ client: trx })
        .where('stockDraftId', draft.id)
        .orderBy('sortOrder', 'asc')
        .orderBy('id', 'asc')
      const line = items[lineIndex]
      if (line && line.productId === null) {
        line.productId = productId
        await line.useTransaction(trx).save()
        await this.touch(draft, trx)
        return { draft, item: line }
      }
      const item = await StockDraftItem.create(
        {
          stockDraftId: draft.id,
          productId,
          productGroupId: null,
          label: null,
          amount: 1,
          purchasePrice: null,
          purchasePriceEstimated: false,
          price: null,
          source: 'web',
          sortOrder: items.length ? Math.max(...items.map((i) => i.sortOrder)) + 1 : 0,
        },
        { client: trx }
      )
      await this.touch(draft, trx)
      return { draft, item }
    })
  }

  async listOpen(supplierId: number) {
    const drafts = await StockDraft.query()
      .where('supplierId', supplierId)
      .where('status', 'open')
      .preload('items')
      .orderBy('createdAt', 'desc')
    return drafts.map((draft) => ({
      id: draft.id,
      source: draft.source,
      note: draft.note,
      createdAt: draft.createdAt.toISO(),
      updatedAt: draft.updatedAt.toISO(),
      lines: draft.items.length,
      pieces: draft.items.reduce((sum, item) => sum + item.amount, 0),
      unmatched: draft.items.filter((item) => item.productId === null).length,
      isEmpty: draft.items.length === 0,
    }))
  }

  /** The open draft in a nutshell for the stock page's chip; null when it has no lines. */
  async openSummary(
    supplierId: number
  ): Promise<{ id: number; lines: number; pieces: number } | null> {
    const row = await db
      .from('stock_drafts as d')
      .join('stock_draft_items as i', 'i.stock_draft_id', 'd.id')
      .where('d.supplier_id', supplierId)
      .where('d.status', 'open')
      .groupBy('d.id')
      .select('d.id')
      .count('i.id as lines')
      .sum('i.amount as pieces')
      .first()
    return row ? { id: Number(row.id), lines: Number(row.lines), pieces: Number(row.pieces) } : null
  }

  /** Open drafts with at least one line — what the nav badge and the stock page chip show. */
  async countOpen(supplierId: number): Promise<number> {
    const row = await db
      .from('stock_drafts')
      .where('supplier_id', supplierId)
      .where('status', 'open')
      .whereExists((sub) =>
        sub.from('stock_draft_items').whereRaw('stock_draft_items.stock_draft_id = stock_drafts.id')
      )
      .count('* as total')
      .first()
    return Number(row?.total ?? 0)
  }

  /** The draft, if the actor may work with it (its supplier, or an admin). */
  async get(actor: Pick<User, 'id' | 'role'>, draftId: number): Promise<StockDraft> {
    const draft = await StockDraft.query()
      .where('id', draftId)
      .preload('items', (q) => q.orderBy('sortOrder', 'asc').orderBy('id', 'asc'))
      .first()
    if (!draft || (draft.supplierId !== actor.id && actor.role !== 'admin')) {
      throw new DomainError<StockDraftErrorCode>('DRAFT_NOT_FOUND')
    }
    return draft
  }

  /**
   * Replaces the lines of an open draft with what the review form holds. With `version`
   * (see `draftVersion`) the save is refused with DRAFT_STALE when the draft changed since
   * the form loaded it — an assistant's fix or another tab must not be overwritten unseen.
   */
  async update(
    actor: Pick<User, 'id' | 'role'>,
    draftId: number,
    input: { note?: string | null; items: StockDraftItemInput[]; version?: number | null },
    options: { strict?: boolean } = {}
  ): Promise<StockDraft> {
    const items = await this.sanitize(input.items, options.strict)
    await db.transaction(async (trx) => {
      const draft = await this.lockOpen(actor, draftId, trx)
      this.checkVersion(draft, input.version)
      if (input.note !== undefined) draft.note = input.note?.trim() || null
      await this.replaceItems(draft.id, items, trx)
      await this.touch(draft, trx)
    })
    return this.get(actor, draftId)
  }

  /**
   * Lines that block stocking: no product picked yet, or no selling price and nothing to
   * derive one from — neither a purchase price nor (when `lastPrices` is given) an earlier
   * selling price of the product.
   */
  static problems(
    items: StockDraftItemInput[],
    lastPrices?: Map<number, { price: number }>
  ): DraftProblem[] {
    const problems: DraftProblem[] = []
    items.forEach((item, index) => {
      if (!item.productId) problems.push({ index, problem: 'product' })
      else if (
        !item.price &&
        (item.purchasePrice === null || item.purchasePrice === undefined) &&
        !lastPrices?.get(item.productId)?.price
      ) {
        problems.push({ index, problem: 'price' })
      }
    })
    return problems
  }

  /**
   * Stocks every line of the draft (optionally saving the reviewed lines first) and closes
   * it, all in one transaction under the draft's lock — a save racing the commit waits and
   * then finds the draft closed, so what is stocked is exactly what was checked. A line
   * without a selling price gets `suggestDraftPrice` (the owner's margin, never below the
   * last selling price). Unless `confirmWarnings` is set, lines that look like a double
   * submit, carry an unusual price or still have an estimated purchase price stop the commit
   * with `StockDraftNeedsConfirmation` — the reviewed lines are saved, nothing is stocked.
   */
  async commit(
    actor: DraftActor,
    draftId: number,
    input?: {
      note?: string | null
      items?: StockDraftItemInput[]
      confirmWarnings?: boolean
      version?: number | null
    }
  ): Promise<{ draft: StockDraft; deliveries: Delivery[] }> {
    const deliveryService = new DeliveryService()
    const reviewed = input?.items ? await this.sanitize(input.items) : null

    // Refusals return from the transaction instead of throwing, so the reviewed lines it
    // saved are kept; the error is raised once it has committed.
    const outcome = await db.transaction(async (trx) => {
      const draft = await this.lockOpen(actor, draftId, trx)
      this.checkVersion(draft, input?.version)
      if (input?.note !== undefined || reviewed) {
        if (input?.note !== undefined) draft.note = input.note?.trim() || null
        if (reviewed) await this.replaceItems(draft.id, reviewed, trx)
        await this.touch(draft, trx)
      }

      const items = await StockDraftItem.query({ client: trx })
        .where('stockDraftId', draft.id)
        .orderBy('sortOrder', 'asc')
        .orderBy('id', 'asc')
      if (items.length === 0) return { refused: 'DRAFT_EMPTY' as const }
      const productIds = [...new Set(items.map((item) => item.productId!).filter(Boolean))]
      const lastPrices = await this.lastPrices(draft.supplierId, productIds, trx)
      if (StockDraftService.problems(items, lastPrices).length > 0) {
        return { refused: 'DRAFT_INCOMPLETE' as const }
      }

      const margin = await this.ownerMargin(actor, draft, trx)
      const prices = items.map(
        (item) =>
          item.price ??
          suggestDraftPrice(item.purchasePrice, margin, lastPrices.get(item.productId!)?.price)!
      )

      if (!input?.confirmWarnings) {
        const warnings = await this.collectWarnings(draft, items, prices, deliveryService, trx)
        if (warnings.length) return { warnings }
      }

      const stockBefore = await this.stockLevels(productIds, trx)
      const deliveries: Delivery[] = []
      for (const [index, item] of items.entries()) {
        const delivery = await deliveryService.addStock(
          draft.supplierId,
          item.productId!,
          item.amount,
          prices[index],
          {
            purchasePrice: item.purchasePrice,
            marginPercent: margin,
            actorId: actor.id,
            client: trx,
          }
        )
        item.useTransaction(trx)
        item.deliveryId = delivery.id
        item.price = delivery.price
        await item.save()
        deliveries.push(delivery)
      }

      draft.status = 'committed'
      draft.committedAt = DateTime.now()
      await draft.useTransaction(trx).save()

      await AuditService.log(
        actor.id,
        'stock_draft.committed',
        'stock_draft',
        draft.id,
        draft.supplierId === actor.id ? null : draft.supplierId,
        {
          source: draft.source,
          deliveries: deliveries.length,
          pieces: deliveries.reduce((sum, d) => sum + d.amountSupplied, 0),
          purchaseTotal: roundMoney(
            items.reduce((sum, item) => sum + (item.purchasePrice ?? 0) * item.amount, 0)
          ),
        },
        { client: trx }
      )

      return { draft, deliveries, stockBefore }
    })

    if ('refused' in outcome) throw new DomainError<StockDraftErrorCode>(outcome.refused!)
    if ('warnings' in outcome) throw new StockDraftNeedsConfirmation(outcome.warnings!)

    // Favourite-product e-mails go out only once the stock really exists, and only for
    // products that had run out.
    runAfterResponse(
      () =>
        new NotificationService().sendRestockNotifications(outcome.deliveries, outcome.stockBefore),
      `restock e-mails for draft #${draftId}`
    )

    return { draft: outcome.draft, deliveries: outcome.deliveries }
  }

  /**
   * The supplier's drafts stocked in the last STOCKED_HISTORY_DAYS (voided ones included),
   * newest first, one page at a time. The MCP history; the web shows `listHistory`.
   */
  async listStocked(supplierId: number, page = 1, perPage = 10) {
    return this.listHistory({ id: supplierId, role: 'supplier' }, page, perPage, {
      scope: 'mine',
      since: DateTime.now().minus({ days: STOCKED_HISTORY_DAYS }),
      sortBy: 'committedAt',
    })
  }

  /**
   * Sklad › Historie › Příjemky: stocked (and voided) drafts, the viewer's own or the whole
   * fridge's, sorted on the server (default newest number first). What a colleague paid
   * stays theirs: their purchase totals are null, and only the owner or an admin may void.
   */
  async listHistory(
    viewer: Pick<User, 'id' | 'role'>,
    page = 1,
    perPage = 20,
    filters: {
      scope?: 'all' | 'mine'
      productId?: number
      since?: DateTime
      sortBy?: string
      sortOrder?: string
    } = {}
  ): Promise<{
    data: StockedDraftRow[]
    meta: { total: number; perPage: number; currentPage: number; lastPage: number }
  }> {
    const sortColumns: Record<string, string> = {
      id: 'd.id',
      committedAt: 'd.committed_at',
      pieces: 'pieces',
      lines: 'lines',
    }
    const sortBy = sortColumns[filters.sortBy ?? ''] ? filters.sortBy! : 'id'
    const sortOrder = filters.sortOrder === 'asc' ? 'asc' : 'desc'
    const isAdmin = viewer.role === 'admin'
    const query = db
      .from('stock_drafts as d')
      .join('users as u', 'u.id', 'd.supplier_id')
      .whereIn('d.status', ['committed', 'voided'])
      .if(filters.scope !== 'all', (q) => q.where('d.supplier_id', viewer.id))
      .if(filters.since, (q) => q.where('d.committed_at', '>=', filters.since!.toJSDate()))
      .if(filters.productId, (q) =>
        q.whereExists((sub) =>
          sub
            .from('stock_draft_items as p')
            .whereRaw('p.stock_draft_id = d.id')
            .where('p.product_id', filters.productId!)
        )
      )
      .select(
        'd.id',
        'd.supplier_id',
        'u.display_name as supplier_name',
        'd.source',
        'd.status',
        'd.note',
        'd.committed_at',
        'd.voided_at',
        db.raw('(SELECT COUNT(*) FROM stock_draft_items i WHERE i.stock_draft_id = d.id) AS lines'),
        db.raw(
          '(SELECT COALESCE(SUM(i.amount), 0) FROM stock_draft_items i WHERE i.stock_draft_id = d.id) AS pieces'
        ),
        db.raw(
          `(SELECT SUM(i.purchase_price * i.amount) FROM stock_draft_items i
             WHERE i.stock_draft_id = d.id AND i.purchase_price IS NOT NULL) AS purchase_total`
        ),
        db.raw(
          `(SELECT COUNT(*) FROM stock_draft_items i
             WHERE i.stock_draft_id = d.id AND i.purchase_price IS NULL) AS lines_without_purchase`
        ),
        db.raw(
          `d.status = 'committed' AND NOT EXISTS (
             SELECT 1 FROM stock_draft_items i JOIN deliveries l ON l.id = i.delivery_id
              WHERE i.stock_draft_id = d.id
                AND (
                  EXISTS (SELECT 1 FROM deliveries t WHERE t.transferred_from_id = l.id)
                  OR (l.voided_at IS NULL
                      AND (l.amount_left <> l.amount_supplied OR l.amount_lost <> 0))
                )
           ) AS can_void`
        )
      )
      .orderBy(sortColumns[sortBy], sortOrder)
      .orderBy('d.id', sortOrder)
    const result = await query.paginate(page, perPage)
    return {
      data: result.all().map((row) => {
        const own = isAdmin || Number(row.supplier_id) === viewer.id
        return {
          id: Number(row.id),
          supplierId: Number(row.supplier_id),
          supplierName: row.supplier_name as string,
          source: row.source as StockDraftSource,
          status: row.status as 'committed' | 'voided',
          note: row.note as string | null,
          committedAt: DateTime.fromJSDate(row.committed_at).toISO()!,
          voidedAt: row.voided_at ? DateTime.fromJSDate(row.voided_at).toISO() : null,
          lines: Number(row.lines),
          pieces: Number(row.pieces),
          purchaseTotal:
            !own || row.purchase_total === null ? null : roundMoney(Number(row.purchase_total)),
          linesWithoutPurchase: own ? Number(row.lines_without_purchase) : 0,
          canVoid: own && Boolean(row.can_void),
        }
      }),
      meta: {
        total: result.total,
        perPage: result.perPage,
        currentPage: result.currentPage,
        lastPage: result.lastPage,
      },
    }
  }

  /**
   * Whether `voidStocked` would accept the draft's lots: nothing sold, lost or counted, and
   * no lot handed over to another supplier (the pieces live on in their lot).
   */
  async canVoid(draftId: number): Promise<boolean> {
    const blocking = await db
      .from('stock_draft_items as i')
      .join('deliveries as l', 'l.id', 'i.delivery_id')
      .where('i.stock_draft_id', draftId)
      .where((q) =>
        q
          .whereExists((t) => t.from('deliveries as t').whereRaw('t.transferred_from_id = l.id'))
          .orWhere((live) =>
            live
              .whereNull('l.voided_at')
              .where((changed) =>
                changed
                  .whereRaw('l.amount_left <> l.amount_supplied')
                  .orWhere('l.amount_lost', '<>', 0)
              )
          )
      )
      .first()
    return !blocking
  }

  /**
   * Voids a stocked draft as a whole — a duplicate receipt, stock that never reached the
   * fridge: every lot of it is voided (`DeliveryService.voidDelivery`) with one reason, in
   * one transaction, and the draft becomes `voided`. Only while none of its lots has sold,
   * lost or gained a piece (DRAFT_HAS_SALES); a lot voided on its own before is skipped.
   */
  async voidStocked(
    actor: Pick<User, 'id' | 'role'>,
    draftId: number,
    reason: string,
    options: { impersonatorId?: number } = {}
  ): Promise<{ draft: StockDraft; voidedDeliveries: number }> {
    const deliveryService = new DeliveryService()
    const outcome = await db.transaction(async (trx) => {
      const draft = await StockDraft.query({ client: trx }).where('id', draftId).forUpdate().first()
      if (!draft || (draft.supplierId !== actor.id && actor.role !== 'admin')) {
        throw new DomainError<StockDraftErrorCode>('DRAFT_NOT_FOUND')
      }
      if (draft.status === 'voided') throw new DomainError<StockDraftErrorCode>('DRAFT_VOIDED')
      if (draft.status !== 'committed') {
        throw new DomainError<StockDraftErrorCode>('DRAFT_NOT_COMMITTED')
      }

      const lines = await trx
        .from('stock_draft_items')
        .where('stock_draft_id', draft.id)
        .whereNotNull('delivery_id')
        .select('delivery_id')
      const deliveryIds = lines.map((row) => Number(row.delivery_id))
      // Lock the lots in id order (= the order the commit created them) and check them all
      // before voiding any, so the answer is one clear refusal.
      const lots = deliveryIds.length
        ? await trx
            .from('deliveries')
            .whereIn('id', deliveryIds)
            .orderBy('id', 'asc')
            .forUpdate()
            .select('id', 'amount_supplied', 'amount_left', 'amount_lost', 'voided_at')
        : []
      // A lot handed over to another supplier lives on in their lot; voiding here would not
      // take those pieces off the shelf.
      const transferred = lots.length
        ? await trx
            .from('deliveries')
            .whereIn('transferred_from_id', deliveryIds)
            .select('id')
            .first()
        : null
      if (transferred) throw new DomainError<StockDraftErrorCode>('DRAFT_TRANSFERRED')
      const live = lots.filter((lot) => lot.voided_at === null)
      if (
        live.some(
          (lot) =>
            Number(lot.amount_left) !== Number(lot.amount_supplied) || Number(lot.amount_lost) !== 0
        )
      ) {
        throw new DomainError<StockDraftErrorCode>('DRAFT_HAS_SALES')
      }

      const results: DeliveryCorrectionResult[] = []
      for (const lot of live) {
        try {
          results.push(
            await deliveryService.voidDelivery(actor, Number(lot.id), reason, {
              impersonatorId: options.impersonatorId,
              client: trx,
            })
          )
        } catch (error) {
          if (
            error instanceof DomainError &&
            ['DELIVERY_HAS_ORDERS', 'DELIVERY_HAS_ADJUSTMENTS'].includes(error.code)
          ) {
            throw new DomainError<StockDraftErrorCode>('DRAFT_HAS_SALES')
          }
          if (error instanceof DomainError && error.code === 'DELIVERY_TRANSFERRED') {
            throw new DomainError<StockDraftErrorCode>('DRAFT_TRANSFERRED')
          }
          throw error
        }
      }

      draft.status = 'voided'
      draft.voidedAt = DateTime.now()
      draft.voidReason = reason
      await draft.useTransaction(trx).save()
      await AuditService.log(
        actor.id,
        'stock_draft.voided',
        'stock_draft',
        draft.id,
        draft.supplierId === actor.id ? null : draft.supplierId,
        {
          source: draft.source,
          reason,
          deliveries: results.length,
          pieces: results.reduce((sum, r) => sum + r.correction.oldAmountSupplied, 0),
        },
        { client: trx }
      )
      return { draft, results }
    })

    for (const result of outcome.results) deliveryService.notifyCorrection(result)
    return { draft: outcome.draft, voidedDeliveries: outcome.results.length }
  }

  async discard(actor: Pick<User, 'id' | 'role'>, draftId: number): Promise<void> {
    await db.transaction(async (trx) => {
      const draft = await this.lockOpen(actor, draftId, trx)
      draft.status = 'discarded'
      await draft.useTransaction(trx).save()
      await AuditService.log(
        actor.id,
        'stock_draft.discarded',
        'stock_draft',
        draft.id,
        draft.supplierId === actor.id ? null : draft.supplierId,
        { source: draft.source },
        { client: trx }
      )
    })
  }

  /**
   * Duplicate / unusual-price / estimated-cost checks for every line, with the selling
   * price the commit will use (`prices`, parallel to `items`).
   */
  private async collectWarnings(
    draft: StockDraft,
    items: StockDraftItem[],
    prices: number[],
    deliveryService: DeliveryService,
    trx: TransactionClientContract
  ): Promise<DraftCommitWarning[]> {
    const products = await Product.query({ client: trx })
      .whereIn('id', [...new Set(items.map((item) => item.productId!))])
      .select('id', 'displayName')
    const names = new Map(products.map((p) => [p.id, p.displayName]))

    const warnings: DraftCommitWarning[] = []
    for (const [index, item] of items.entries()) {
      const found = await deliveryService.getStockWarnings(
        draft.supplierId,
        item.productId!,
        prices[index],
        { purchasePrice: item.purchasePrice, client: trx }
      )
      const estimatedPurchasePrice = item.purchasePriceEstimated && item.purchasePrice !== null
      if (found || estimatedPurchasePrice) {
        warnings.push({
          index,
          productId: item.productId!,
          productName: names.get(item.productId!) ?? item.label ?? '—',
          price: prices[index],
          ...(found ?? NO_STOCK_WARNINGS),
          estimatedPurchasePrice,
        })
      }
    }
    return warnings
  }

  /** Pieces on the shelf per product right now (non-voided lots). */
  private async stockLevels(
    productIds: number[],
    trx: TransactionClientContract
  ): Promise<Map<number, number>> {
    if (productIds.length === 0) return new Map()
    const rows = await trx
      .from('deliveries')
      .whereNull('voided_at')
      .whereIn('product_id', productIds)
      .groupBy('product_id')
      .select('product_id')
      .sum('amount_left as left')
    const levels = new Map<number, number>(productIds.map((id) => [id, 0]))
    for (const row of rows) levels.set(Number(row.product_id), Number(row.left ?? 0))
    return levels
  }

  /** The lots belong to the draft's supplier even when an admin commits it for them. */
  private async ownerMargin(
    actor: DraftActor | null,
    draft: StockDraft,
    trx?: TransactionClientContract
  ): Promise<number> {
    if (actor && actor.id === draft.supplierId) return Number(actor.marginPercent ?? 0)
    const owner = await (trx ?? db)
      .from('users')
      .where('id', draft.supplierId)
      .select('margin_percent')
      .first()
    return Number(owner?.margin_percent ?? 0)
  }

  private async lockOpen(
    actor: Pick<User, 'id' | 'role'>,
    draftId: number,
    trx: TransactionClientContract
  ): Promise<StockDraft> {
    const draft = await StockDraft.query({ client: trx }).where('id', draftId).forUpdate().first()
    if (!draft || (draft.supplierId !== actor.id && actor.role !== 'admin')) {
      throw new DomainError<StockDraftErrorCode>('DRAFT_NOT_FOUND')
    }
    if (draft.status !== 'open') throw new DomainError<StockDraftErrorCode>('DRAFT_CLOSED')
    return draft
  }

  private checkVersion(draft: StockDraft, version: number | null | undefined) {
    if (version === null || version === undefined) return
    if (draftVersion(draft) !== version) throw new DomainError<StockDraftErrorCode>('DRAFT_STALE')
  }

  /** Every change to a draft moves its version, even one that only touched its lines. */
  private async touch(draft: StockDraft, trx: TransactionClientContract) {
    const previous = draft.updatedAt
    if (draft.$isDirty) await draft.useTransaction(trx).save()
    // Strictly later than before, so two changes within a millisecond still differ.
    const now = DateTime.now()
    const next = now > previous ? now : previous.plus({ milliseconds: 1 })
    await trx.from('stock_drafts').where('id', draft.id).update({ updated_at: next.toJSDate() })
    draft.updatedAt = next
  }

  /** Serialises picking (or creating) the supplier's current draft. Transaction-scoped. */
  private async lockCurrentDraft(supplierId: number, trx: TransactionClientContract) {
    await trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [CURRENT_DRAFT_LOCK, supplierId])
  }

  /** The supplier's open draft, locked; the caller holds `lockCurrentDraft`. */
  private async openDraft(
    supplierId: number,
    trx: TransactionClientContract
  ): Promise<StockDraft | null> {
    return StockDraft.query({ client: trx })
      .where('supplierId', supplierId)
      .where('status', 'open')
      .forUpdate()
      .first()
  }

  /** See `findOrCreateOpenDraft`; the caller holds `lockCurrentDraft`. */
  private async currentDraft(
    supplierId: number,
    trx: TransactionClientContract
  ): Promise<StockDraft> {
    const open = await this.openDraft(supplierId, trx)
    if (open) return open
    const { draft } = await this.appendLines(
      supplierId,
      { source: 'web', items: [] },
      { client: trx }
    )
    return draft
  }

  /** The one place lines are rewritten: `update` and `commit` both go through it. */
  private async replaceItems(
    draftId: number,
    items: SanitizedItem[],
    trx: TransactionClientContract
  ): Promise<void> {
    await StockDraftItem.query({ client: trx }).where('stockDraftId', draftId).delete()
    await this.insertItems(draftId, items, trx)
  }

  private async insertItems(
    draftId: number,
    items: SanitizedItem[],
    trx: TransactionClientContract,
    startOrder = 0
  ): Promise<void> {
    if (!items.length) return
    await StockDraftItem.createMany(
      items.map((item, index) => ({
        ...item,
        stockDraftId: draftId,
        sortOrder: startOrder + index,
      })),
      { client: trx }
    )
  }

  /**
   * Normalises lines: money is rounded to cents, a line without a single piece is dropped.
   * Unknown products and groups become unmatched (null) — a stale id from a form must not
   * end as a foreign-key error — or, with `strict`, are refused with
   * `StockDraftUnknownReference` naming the line.
   */
  private async sanitize(items: StockDraftItemInput[], strict = false): Promise<SanitizedItem[]> {
    const productIds = [
      ...new Set(items.map((i) => i.productId).filter((id): id is number => !!id)),
    ]
    const groupIds = [
      ...new Set(items.map((i) => i.productGroupId).filter((id): id is number => !!id)),
    ]
    const [products, groups] = await Promise.all([
      productIds.length ? Product.query().whereIn('id', productIds).select('id') : [],
      groupIds.length ? ProductGroup.query().whereIn('id', groupIds).select('id') : [],
    ])
    const knownProducts = new Set(products.map((p) => p.id))
    const knownGroups = new Set(groups.map((g) => g.id))
    if (strict) {
      items.forEach((item, index) => {
        if (item.productId && !knownProducts.has(item.productId)) {
          throw new StockDraftUnknownReference('PRODUCT_NOT_FOUND', index, item.productId)
        }
        if (item.productGroupId && !knownGroups.has(item.productGroupId)) {
          throw new StockDraftUnknownReference('GROUP_NOT_FOUND', index, item.productGroupId)
        }
      })
    }
    return items
      .filter((item) => Number.isFinite(item.amount) && Math.floor(item.amount) >= 1)
      .map((item) => {
        const purchasePrice =
          item.purchasePrice === null || item.purchasePrice === undefined
            ? null
            : roundMoney(item.purchasePrice)
        return {
          productId: item.productId && knownProducts.has(item.productId) ? item.productId : null,
          productGroupId:
            item.productGroupId && knownGroups.has(item.productGroupId)
              ? item.productGroupId
              : null,
          label: item.label?.trim().slice(0, 255) || null,
          amount: Math.floor(item.amount),
          purchasePrice,
          purchasePriceEstimated: purchasePrice !== null && !!item.purchasePriceEstimated,
          price: item.price ? Math.round(item.price) : null,
          source: item.source ?? 'web',
        }
      })
  }
}
