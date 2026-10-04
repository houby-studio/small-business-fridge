import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import logger from '@adonisjs/core/services/logger'
import StockDraft, { type StockDraftSource } from '#models/stock_draft'
import StockDraftItem from '#models/stock_draft_item'
import Product from '#models/product'
import ProductGroup from '#models/product_group'
import type Delivery from '#models/delivery'
import type User from '#models/user'
import DeliveryService, { type StockWarnings } from '#services/delivery_service'
import NotificationService from '#services/notification_service'
import AuditService from '#services/audit_service'
import { DomainError } from '#services/domain_error'
import { roundMoney, suggestSellingPrice } from '#services/shopping/pricing'

export type StockDraftErrorCode =
  | 'DRAFT_NOT_FOUND'
  | 'DRAFT_CLOSED'
  | 'DRAFT_EMPTY'
  | 'DRAFT_INCOMPLETE'
  | 'PRODUCT_NOT_FOUND'

export interface StockDraftItemInput {
  productId?: number | null
  productGroupId?: number | null
  label?: string | null
  amount: number
  purchasePrice?: number | null
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
  price: number | null
}

/**
 * Stocking drafts ("příjemky"): lines prepared ahead — by hand on the web, by an AI
 * assistant over MCP (typically from a receipt photo) or by a finished shopping list — and
 * stocked in one go once the supplier has checked them. Committing creates one delivery per
 * line in a single transaction, so a draft is stocked completely or not at all.
 */
export default class StockDraftService {
  /**
   * Creates a draft with its lines. Pass `client` to create it inside a larger transaction
   * (finishing a shopping list): the draft and its audit entry then roll back with it.
   */
  async create(
    supplierId: number,
    input: { source: StockDraftSource; note?: string | null; items: StockDraftItemInput[] },
    options: { client?: TransactionClientContract } = {}
  ): Promise<StockDraft> {
    const items = await this.sanitize(input.items)
    const insert = async (trx: TransactionClientContract) => {
      const created = await StockDraft.create(
        { supplierId, source: input.source, note: input.note?.trim() || null, status: 'open' },
        { client: trx }
      )
      await this.insertItems(created.id, items, trx)
      await AuditService.log(
        supplierId,
        'stock_draft.created',
        'stock_draft',
        created.id,
        null,
        {
          source: created.source,
          lines: items.length,
          pieces: items.reduce((sum, item) => sum + item.amount, 0),
        },
        { client: trx }
      )
      return created
    }
    return options.client ? insert(options.client) : db.transaction(insert)
  }

  /**
   * The supplier's current web draft: their newest open one started by hand, or a new empty
   * one. Clicking "Stock" twice therefore lands on the same draft instead of littering the
   * list with empty ones.
   */
  async findOrCreateWebDraft(supplierId: number): Promise<StockDraft> {
    const existing = await StockDraft.query()
      .where('supplierId', supplierId)
      .where('status', 'open')
      .where('source', 'web')
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .first()
    if (existing) return existing
    return this.create(supplierId, { source: 'web', items: [] })
  }

  /**
   * "Stock this product": appends a line for it to the supplier's web draft, prefilled
   * with one piece and the prices of the product's last lot (the selling price may be
   * null — the form then suggests one from the margin).
   */
  async appendProduct(
    supplierId: number,
    productId: number
  ): Promise<{ draft: StockDraft; item: StockDraftItem }> {
    const product = await Product.find(productId)
    if (!product) throw new DomainError<StockDraftErrorCode>('PRODUCT_NOT_FOUND')

    const draft = await this.findOrCreateWebDraft(supplierId)
    const lastPrices = await new DeliveryService().getLastPrices([productId])
    const last = lastPrices.get(productId)
    const lastLine = await db
      .from('stock_draft_items')
      .where('stock_draft_id', draft.id)
      .max('sort_order as max')
      .first()
    const item = await StockDraftItem.create({
      stockDraftId: draft.id,
      productId,
      productGroupId: null,
      label: null,
      amount: 1,
      purchasePrice: last?.purchasePrice ?? null,
      price: last?.price ?? null,
      sortOrder:
        lastLine?.max === null || lastLine?.max === undefined ? 0 : Number(lastLine.max) + 1,
    })
    return { draft, item }
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
          price: null,
          sortOrder: items.length ? Math.max(...items.map((i) => i.sortOrder)) + 1 : 0,
        },
        { client: trx }
      )
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
      lines: draft.items.length,
      pieces: draft.items.reduce((sum, item) => sum + item.amount, 0),
      unmatched: draft.items.filter((item) => item.productId === null).length,
      isEmpty: draft.items.length === 0,
    }))
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

  /** Replaces the lines of an open draft with what the review form holds. */
  async update(
    actor: Pick<User, 'id' | 'role'>,
    draftId: number,
    input: { note?: string | null; items: StockDraftItemInput[] }
  ): Promise<StockDraft> {
    const items = await this.sanitize(input.items)
    await db.transaction(async (trx) => {
      const draft = await this.lockOpen(actor, draftId, trx)
      if (input.note !== undefined) {
        draft.note = input.note?.trim() || null
        await draft.useTransaction(trx).save()
      }
      await this.replaceItems(draft.id, items, trx)
    })
    return this.get(actor, draftId)
  }

  /**
   * Lines that block stocking: no product picked yet, or no selling price and no purchase
   * price to derive one from.
   */
  static problems(items: StockDraftItemInput[]): DraftProblem[] {
    const problems: DraftProblem[] = []
    items.forEach((item, index) => {
      if (!item.productId) problems.push({ index, problem: 'product' })
      else if (!item.price && (item.purchasePrice === null || item.purchasePrice === undefined)) {
        problems.push({ index, problem: 'price' })
      }
    })
    return problems
  }

  /**
   * Stocks every line of the draft (optionally saving the reviewed lines first) and closes
   * it. A line without a selling price gets one from its purchase price and the owner's
   * margin. Unless `confirmWarnings` is set, lines that look like a double submit or carry
   * an unusual price stop the commit with `StockDraftNeedsConfirmation` — the lines stay
   * saved, nothing is stocked.
   */
  async commit(
    actor: DraftActor,
    draftId: number,
    input?: { note?: string | null; items?: StockDraftItemInput[]; confirmWarnings?: boolean }
  ): Promise<{ draft: StockDraft; deliveries: Delivery[] }> {
    const deliveryService = new DeliveryService()

    // The reviewed lines are saved on their own first: a warning must leave them in place.
    if (input && (input.items || input.note !== undefined)) {
      const reviewed = input.items ? await this.sanitize(input.items) : null
      await db.transaction(async (trx) => {
        const draft = await this.lockOpen(actor, draftId, trx)
        if (input.note !== undefined) {
          draft.note = input.note?.trim() || null
          await draft.useTransaction(trx).save()
        }
        if (reviewed) await this.replaceItems(draft.id, reviewed, trx)
      })
    }

    if (!input?.confirmWarnings) {
      const draft = await this.get(actor, draftId)
      if (draft.status !== 'open') throw new DomainError<StockDraftErrorCode>('DRAFT_CLOSED')
      const warnings = await this.collectWarnings(draft, deliveryService)
      if (warnings.length) throw new StockDraftNeedsConfirmation(warnings)
    }

    const result = await db.transaction(async (trx) => {
      const draft = await this.lockOpen(actor, draftId, trx)
      const items = await StockDraftItem.query({ client: trx })
        .where('stockDraftId', draft.id)
        .orderBy('sortOrder', 'asc')
        .orderBy('id', 'asc')
      if (items.length === 0) throw new DomainError<StockDraftErrorCode>('DRAFT_EMPTY')
      if (StockDraftService.problems(items).length > 0) {
        throw new DomainError<StockDraftErrorCode>('DRAFT_INCOMPLETE')
      }

      const margin = await this.ownerMargin(actor, draft, trx)

      const deliveries: Delivery[] = []
      for (const item of items) {
        const delivery = await deliveryService.addStock(
          draft.supplierId,
          item.productId!,
          item.amount,
          item.price,
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

      return { draft, deliveries }
    })

    // Favourite-product e-mails go out only once the stock really exists.
    const notifications = new NotificationService()
    for (const delivery of result.deliveries) {
      notifications.sendRestockNotification(delivery).catch((err) => {
        logger.error({ err }, `Failed to send restock notifications for delivery #${delivery.id}`)
      })
    }

    return result
  }

  async discard(actor: Pick<User, 'id' | 'role'>, draftId: number): Promise<void> {
    const draft = await db.transaction(async (trx) => {
      const locked = await this.lockOpen(actor, draftId, trx)
      locked.status = 'discarded'
      await locked.useTransaction(trx).save()
      return locked
    })
    await AuditService.log(
      actor.id,
      'stock_draft.discarded',
      'stock_draft',
      draft.id,
      draft.supplierId === actor.id ? null : draft.supplierId,
      { source: draft.source }
    )
  }

  /**
   * Duplicate / unusual-price checks for every complete line, with the selling price the
   * commit would use. Lines with problems are skipped — the commit refuses them anyway.
   */
  private async collectWarnings(
    draft: StockDraft,
    deliveryService: DeliveryService
  ): Promise<DraftCommitWarning[]> {
    const items = draft.items
    const complete = items.filter(
      (item) => item.productId && (item.price || item.purchasePrice !== null)
    )
    if (complete.length === 0) return []

    const margin = await this.ownerMargin(null, draft)
    const products = await Product.query()
      .whereIn('id', [...new Set(complete.map((item) => item.productId!))])
      .select('id', 'displayName')
    const names = new Map(products.map((p) => [p.id, p.displayName]))

    const warnings: DraftCommitWarning[] = []
    for (const [index, item] of items.entries()) {
      if (!complete.includes(item)) continue
      const price = item.price ?? suggestSellingPrice(item.purchasePrice!, margin)
      const found = await deliveryService.getStockWarnings(draft.supplierId, item.productId!, price)
      if (found) {
        warnings.push({
          index,
          productId: item.productId!,
          productName: names.get(item.productId!) ?? item.label ?? '—',
          ...found,
        })
      }
    }
    return warnings
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
    trx: TransactionClientContract
  ): Promise<void> {
    if (!items.length) return
    await StockDraftItem.createMany(
      items.map((item, index) => ({ ...item, stockDraftId: draftId, sortOrder: index })),
      { client: trx }
    )
  }

  /**
   * Normalises lines: unknown products and groups become unmatched (null), money is rounded
   * to cents. A stale id from a form must not end as a foreign-key error.
   */
  private async sanitize(items: StockDraftItemInput[]): Promise<SanitizedItem[]> {
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
    return items.map((item) => ({
      productId: item.productId && knownProducts.has(item.productId) ? item.productId : null,
      productGroupId:
        item.productGroupId && knownGroups.has(item.productGroupId) ? item.productGroupId : null,
      label: item.label?.trim().slice(0, 255) || null,
      amount: Math.max(1, Math.floor(item.amount)),
      purchasePrice:
        item.purchasePrice === null || item.purchasePrice === undefined
          ? null
          : roundMoney(item.purchasePrice),
      price: item.price ? Math.round(item.price) : null,
    }))
  }
}
