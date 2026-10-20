import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Product from '#models/product'
import ProductGroup from '#models/product_group'
import ShoppingList, { type ShoppingListScope } from '#models/shopping_list'
import ShoppingListItem from '#models/shopping_list_item'
import type StockDraft from '#models/stock_draft'
import type User from '#models/user'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { FRIDGE_TIMEZONE } from '#config/fridge'
import AuditService from '#services/audit_service'
import { DomainError } from '#services/domain_error'
import { isUniqueViolation } from '#services/unique_violation'
import StockDraftService from '#services/shopping/stock_draft_service'
import {
  LOOKBACK_DAYS,
  clampHorizon,
  defaultHorizonDays,
  estimateRate,
  expectedOpenDays,
  inferPackSize,
  openProbabilityByWeekday,
  percentile,
  stockoutRisk,
  suggestQuantity,
  tripCadenceDays,
  weightedMedian,
  type DayObservation,
} from '#services/shopping/demand_math'
import { roundMoney, suggestSellingPrice } from '#services/shopping/pricing'
import { STOCK_DRAFT_NOTE_MAX } from '#validators/shopping'

/** Lots whose prices feed the expected and the "good" price. */
const PRICE_WINDOW_DAYS = 365
const PRICE_SAMPLE_LOTS = 6
/** A product of its own is planned only once it is a habit: restocked and selling. */
const STAPLE_WINDOW_DAYS = 180
const STAPLE_MIN_DELIVERIES = 2
const STAPLE_MIN_SOLD = 3
const HINT_COUNT = 4

export type ShoppingListErrorCode =
  | 'LINE_NOT_FOUND'
  | 'PRODUCT_NOT_FOUND'
  | 'GROUP_NOT_FOUND'
  | 'LIST_EMPTY'

export type LineKind = 'group' | 'product' | 'custom'
export type CostSource = 'purchase' | 'selling' | 'manual'
export type LineReason = 'out_of_stock' | 'runs_out' | 'added'

export interface ShoppingLineHint {
  productId: number
  name: string
  stock: number
  sold: number
  favorites: number
}

export interface ShoppingLine {
  /** `g-<groupId>`, `p-<productId>` or `c-<itemId>` — stable across recomputations. */
  key: string
  kind: LineKind
  groupId: number | null
  productId: number | null
  name: string
  categoryId: number | null
  categoryName: string | null
  categoryColor: string | null
  /** The group's description or the supplier's note on the line. */
  note: string | null
  stock: number | null
  /** Pieces the fridge sells in a typical week. */
  weeklyRate: number | null
  /** Calendar days the current stock lasts at that pace (null = it does not sell). */
  daysOfCover: number | null
  /** Chance (0–1) it sells out before the next trip if nothing is bought. */
  stockoutRisk: number | null
  /** Expected sales until the next trip. */
  demand: number | null
  suggestedQuantity: number
  quantity: number
  isOverridden: boolean
  packSize: number
  /** The lot sizes the pack size was told from (newest first, at most 5) — shown as a hint. */
  packSample: number[]
  unitCost: number | null
  costSource: CostSource | null
  /** A price worth stocking up at — the cheapest quarter of past purchases. */
  goodPrice: number | null
  /** Selling price that keeps the supplier's margin at the expected cost. */
  sellingPrice: number | null
  lineTotal: number | null
  isChecked: boolean
  isRemoved: boolean
  hints: ShoppingLineHint[]
  reasons: LineReason[]
}

export interface ShoppingListSettings {
  horizonDays: number
  /** Days between the supplier's usual trips — the horizon when they did not pick one. */
  autoHorizonDays: number
  horizonIsAuto: boolean
  scope: ShoppingListScope
  categoryIds: number[]
}

export interface ShoppingListView {
  settings: ShoppingListSettings
  openDaysInHorizon: number
  lines: ShoppingLine[]
  /** Planned items the fridge has enough of — shown so the supplier can still add some. */
  covered: ShoppingLine[]
  removed: ShoppingLine[]
  totals: {
    lines: number
    pieces: number
    cost: number
    checked: number
    linesWithoutCost: number
  }
  marginPercent: number
}

export interface SettingsOverrides {
  horizonDays?: number | null
  scope?: ShoppingListScope
  categoryIds?: number[]
}

export interface LinePatch {
  quantity?: number | null
  unitCost?: number | null
  isChecked?: boolean
  isRemoved?: boolean
  note?: string | null
}

export interface CompleteListOptions {
  /** The draft's note, e.g. "Nákupní seznam 3. 10. 2026". */
  note: string
  /**
   * Formats the lines without a product ("Mléko do kávy 2×, Banány 3×") into the note's
   * second line — they are bought, but there is nothing to stock.
   */
  extrasNote: (items: string) => string
  /**
   * What stands for the free-text lines that did not fit into the note (" a další 3").
   * Defaults to " +3".
   */
  moreExtras?: (count: number, afterOthers: boolean) => string
}

export interface CompletedList {
  draft: StockDraft
  /** Draft lines written. */
  lines: number
  pieces: number
  /** Free-text lines that went into the note instead. */
  extras: number
}

interface DeliveryRow {
  productId: number
  supplierId: number
  amountSupplied: number
  price: number
  purchasePrice: number | null
  createdAt: number
  dayIndex: number | null
}

interface Series {
  sold: number[]
  supplied: number[]
  lost: number[]
}

interface ItemStats {
  stock: number
  rate: number
  soldInWindow: number
  deliveries: DeliveryRow[]
}

interface Context {
  supplierId: number
  marginPercent: number
  dayCount: number
  open: boolean[]
  weekly: number
  avgOpenPerDay: number
  openDaysInHorizon: number
  horizonDays: number
  stapleSince: number
}

export function parseLineKey(key: string): { kind: LineKind; id: number } | null {
  const match = /^([gpc])-(\d{1,9})$/.exec(key)
  if (!match) return null
  const kind = ({ g: 'group', p: 'product', c: 'custom' } as const)[match[1] as 'g' | 'p' | 'c']
  return { kind, id: Number(match[2]) }
}

/**
 * The supplier's shopping list: what the fridge will sell until the next trip, minus what
 * is in it, per purchase group (any flavour will do) and per stand-alone staple product —
 * merged with the supplier's own changes. docs/shopping-list.md describes the model.
 */
export default class ShoppingListService {
  /**
   * The list as the supplier sees it. `overrides` plan with other settings without saving
   * them — an assistant asking "and for a week?" must not move the supplier's slider.
   */
  async getView(
    supplier: Pick<User, 'id' | 'marginPercent'>,
    overrides: SettingsOverrides = {}
  ): Promise<ShoppingListView> {
    const list = await this.findActive(supplier.id)
    // Before the first change the list exists only on screen — it plans with the settings
    // the supplier left on their last list.
    const settings = list ? {} : await this.lastSettings(supplier.id)
    return this.buildView(supplier, list, { ...settings, ...overrides })
  }

  /**
   * The planning settings of the supplier's last finished list. They are the supplier's
   * habit (how far ahead, whose stock, which categories), not a property of one trip, so a
   * new list starts with them; the lines do not carry over.
   */
  async lastSettings(supplierId: number): Promise<Required<SettingsOverrides>> {
    const last = await ShoppingList.query()
      .where('supplierId', supplierId)
      .where('status', 'done')
      .orderBy('completedAt', 'desc')
      .orderBy('id', 'desc')
      .first()
    return {
      horizonDays: last?.horizonDays ?? null,
      scope: last?.scope ?? 'mine',
      categoryIds: last?.categoryIds ?? [],
    }
  }

  /** The active list; inside a transaction it is locked, so two completions cannot cross. */
  async findActive(
    supplierId: number,
    trx?: TransactionClientContract
  ): Promise<ShoppingList | null> {
    const query = ShoppingList.query({ client: trx })
      .where('supplierId', supplierId)
      .where('status', 'active')
      .preload('items', (q) => q.orderBy('id', 'asc'))
    if (trx) query.forUpdate()
    return query.first()
  }

  async ensureActive(supplierId: number): Promise<ShoppingList> {
    const existing = await this.findActive(supplierId)
    if (existing) return existing
    try {
      const created = await ShoppingList.create({
        supplierId,
        status: 'active',
        ...(await this.lastSettings(supplierId)),
      })
      await created.load('items')
      return created
    } catch (err) {
      // Two tabs opened the list at once — the partial unique index let one of them win.
      if (isUniqueViolation(err)) return (await this.findActive(supplierId))!
      throw err
    }
  }

  async updateSettings(
    supplierId: number,
    settings: { horizonDays?: number | null; scope?: ShoppingListScope; categoryIds?: number[] }
  ): Promise<void> {
    const list = await this.ensureActive(supplierId)
    if (settings.horizonDays !== undefined) {
      list.horizonDays = settings.horizonDays === null ? null : clampHorizon(settings.horizonDays)
    }
    if (settings.scope !== undefined) list.scope = settings.scope
    if (settings.categoryIds !== undefined) list.categoryIds = [...new Set(settings.categoryIds)]
    await list.save()
  }

  /**
   * Changes only the fields in `patch`. Edits of one line from two tabs (or the web and an
   * assistant) merge field by field: Lucid writes just the changed columns, so a tick and a
   * quantity sent at once both stick; the same field changed twice is last write wins.
   */
  async updateLine(supplierId: number, key: string, patch: LinePatch): Promise<void> {
    const ref = parseLineKey(key)
    if (!ref) throw new DomainError<ShoppingListErrorCode>('LINE_NOT_FOUND')
    const list = await this.ensureActive(supplierId)
    const item = await this.itemFor(list, ref, true)
    if (patch.quantity !== undefined) item.quantity = patch.quantity
    if (patch.unitCost !== undefined) {
      item.unitCost = patch.unitCost === null ? null : roundMoney(patch.unitCost)
    }
    if (patch.isChecked !== undefined) item.isChecked = patch.isChecked
    if (patch.isRemoved !== undefined) item.isRemoved = patch.isRemoved
    if (patch.note !== undefined) item.note = patch.note?.trim() || null
    await item.save()
  }

  /** Drops the supplier's change to a line: an override resets, an own line disappears. */
  async resetLine(supplierId: number, key: string): Promise<void> {
    const ref = parseLineKey(key)
    if (!ref) throw new DomainError<ShoppingListErrorCode>('LINE_NOT_FOUND')
    const list = await this.findActive(supplierId)
    if (!list) return
    const item = await this.itemFor(list, ref, false)
    if (item) await item.delete()
  }

  async addLine(
    supplierId: number,
    input: {
      productId?: number | null
      label?: string | null
      quantity: number
      unitCost?: number | null
      note?: string | null
    }
  ): Promise<string> {
    const list = await this.ensureActive(supplierId)
    if (input.productId) {
      const item = await this.itemFor(list, { kind: 'product', id: input.productId }, true)
      item.quantity = input.quantity
      item.isRemoved = false
      if (input.unitCost !== undefined && input.unitCost !== null) {
        item.unitCost = roundMoney(input.unitCost)
      }
      if (input.note !== undefined) item.note = input.note?.trim() || null
      await item.save()
      return `p-${input.productId}`
    }

    const item = await ShoppingListItem.create({
      shoppingListId: list.id,
      kind: 'custom',
      label: (input.label ?? '').trim(),
      quantity: input.quantity,
      unitCost:
        input.unitCost === undefined || input.unitCost === null ? null : roundMoney(input.unitCost),
      note: input.note?.trim() || null,
      isRemoved: false,
      isChecked: false,
    })
    return `c-${item.id}`
  }

  /** Closes the list; the next visit starts a fresh one. */
  async markDone(list: ShoppingList, trx?: TransactionClientContract): Promise<void> {
    if (trx) list.useTransaction(trx)
    list.status = 'done'
    list.completedAt = DateTime.now()
    await list.save()
  }

  /**
   * Turns the list into a stocking draft and closes it, all in one transaction: the lines
   * ticked as bought, or every line when nothing is ticked. Groups become draft lines
   * without a product (the supplier picks the flavour they got), free-text lines have
   * nothing to stock and are kept in the draft's note instead.
   */
  async completeIntoDraft(
    supplier: Pick<User, 'id' | 'marginPercent'>,
    options: CompleteListOptions
  ): Promise<CompletedList> {
    return db.transaction(async (trx) => {
      const list = await this.findActive(supplier.id, trx)
      if (!list) throw new DomainError<ShoppingListErrorCode>('LIST_EMPTY')

      const view = await this.buildView(supplier, list)
      const wanted = view.lines.filter((line) => line.quantity > 0)
      const ticked = wanted.filter((line) => line.isChecked)
      const picked = ticked.length ? ticked : wanted
      if (picked.length === 0) throw new DomainError<ShoppingListErrorCode>('LIST_EMPTY')

      const stockable = picked.filter((line) => line.kind !== 'custom')
      const extras = picked.filter((line) => line.kind === 'custom')
      let note = options.note
      if (extras.length) note = this.noteWithExtras(options, extras)

      const draft = await new StockDraftService().create(
        supplier.id,
        {
          source: 'shopping_list',
          note,
          items: stockable.map((line) => ({
            productId: line.productId,
            productGroupId: line.kind === 'group' ? line.groupId : null,
            label: line.name,
            amount: line.quantity,
            purchasePrice: line.costSource === 'selling' ? null : line.unitCost,
            price: line.costSource === 'selling' ? line.sellingPrice : null,
          })),
        },
        { client: trx }
      )
      await this.markDone(list, trx)

      const pieces = stockable.reduce((sum, line) => sum + line.quantity, 0)
      await AuditService.log(
        supplier.id,
        'shopping_list.completed',
        'shopping_list',
        list.id,
        null,
        { lines: stockable.length, pieces, draftId: draft.id },
        { client: trx }
      )
      return { draft, lines: stockable.length, pieces, extras: extras.length }
    })
  }

  /**
   * The draft note with the free-text lines — as many as fit, then "and N more" instead of
   * a list silently cut off mid-word.
   */
  private noteWithExtras(options: CompleteListOptions, extras: ShoppingLine[]): string {
    const names = extras.map((line) => `${line.name} ${line.quantity}×`)
    const more = options.moreExtras ?? ((count: number) => ` +${count}`)
    for (let shown = names.length; shown >= 0; shown--) {
      const rest = names.length - shown
      const items = names.slice(0, shown).join(', ') + (rest ? more(rest, shown > 0) : '')
      const note = `${options.note}\n${options.extrasNote(items)}`
      if (note.length <= STOCK_DRAFT_NOTE_MAX) return note
    }
    return options.note.slice(0, STOCK_DRAFT_NOTE_MAX)
  }

  // ── Computation ────────────────────────────────────────────────────────────────

  async buildView(
    supplier: Pick<User, 'id' | 'marginPercent'>,
    list: ShoppingList | null,
    overrides: SettingsOverrides = {}
  ): Promise<ShoppingListView> {
    const marginPercent = Number(supplier.marginPercent ?? 0)
    const items = list?.items ?? []
    const scope: ShoppingListScope = overrides.scope ?? list?.scope ?? 'mine'
    const categoryIds = overrides.categoryIds ?? list?.categoryIds ?? []
    const chosenHorizon =
      overrides.horizonDays !== undefined ? overrides.horizonDays : (list?.horizonDays ?? null)

    const now = DateTime.now().setZone(FRIDGE_TIMEZONE)
    const today = now.startOf('day')
    const windowStart = today.minus({ days: LOOKBACK_DAYS })
    const dayKeys: string[] = []
    for (let day = windowStart; day <= today; day = day.plus({ days: 1 })) {
      dayKeys.push(day.toISODate()!)
    }
    const dayIndex = new Map(dayKeys.map((key, index) => [key, index]))
    const dayCount = dayKeys.length

    const priceSince = today.minus({ days: PRICE_WINDOW_DAYS })
    const [salesRows, deliveryRows, stockRows, lossRows, favoriteRows] = await Promise.all([
      db.rawQuery<{ rows: Array<{ product_id: number; day: string; sold: number }> }>(
        `SELECT d.product_id, to_char((o.created_at AT TIME ZONE ?)::date, 'YYYY-MM-DD') AS day,
                COUNT(*)::int AS sold
           FROM orders o
           JOIN deliveries d ON d.id = o.delivery_id
          WHERE o.created_at >= ?
          GROUP BY 1, 2`,
        [FRIDGE_TIMEZONE, windowStart.toJSDate()]
      ),
      db.rawQuery<{
        rows: Array<{
          product_id: number
          supplier_id: number
          amount_supplied: number
          price: number
          purchase_price: string | null
          created_at: Date
          day: string
        }>
      }>(
        `SELECT product_id, supplier_id, amount_supplied, price, purchase_price, created_at,
                to_char((created_at AT TIME ZONE ?)::date, 'YYYY-MM-DD') AS day
           FROM deliveries
          WHERE voided_at IS NULL AND created_at >= ?
          ORDER BY created_at DESC, id DESC`,
        [FRIDGE_TIMEZONE, priceSince.toJSDate()]
      ),
      db.rawQuery<{ rows: Array<{ product_id: number; stock: number }> }>(
        `SELECT product_id, SUM(amount_left)::int AS stock
           FROM deliveries
          WHERE voided_at IS NULL
          GROUP BY product_id
         HAVING SUM(amount_left) <> 0`
      ),
      db.rawQuery<{ rows: Array<{ product_id: number; day: string; lost: number }> }>(
        `SELECT product_id, to_char((created_at AT TIME ZONE ?)::date, 'YYYY-MM-DD') AS day,
                SUM(CASE WHEN kind = 'loss' THEN quantity ELSE -quantity END)::int AS lost
           FROM stock_adjustments
          WHERE created_at >= ? AND reverted_at IS NULL
          GROUP BY 1, 2`,
        [FRIDGE_TIMEZONE, windowStart.toJSDate()]
      ),
      db.rawQuery<{ rows: Array<{ product_id: number; favorites: number }> }>(
        `SELECT uf.product_id, COUNT(*)::int AS favorites
           FROM user_favorites uf
           JOIN users u ON u.id = uf.user_id
          WHERE u.is_disabled = false
          GROUP BY 1`
      ),
    ])

    // ── Per-day series ──
    const series = new Map<number, Series>()
    const seriesOf = (productId: number) => {
      let s = series.get(productId)
      if (!s) {
        s = {
          sold: new Array(dayCount).fill(0),
          supplied: new Array(dayCount).fill(0),
          lost: new Array(dayCount).fill(0),
        }
        series.set(productId, s)
      }
      return s
    }
    const traffic = new Array(dayCount).fill(0)
    for (const row of salesRows.rows) {
      const index = dayIndex.get(row.day)
      if (index === undefined) continue
      seriesOf(Number(row.product_id)).sold[index] += Number(row.sold)
      traffic[index] += Number(row.sold)
    }
    for (const row of lossRows.rows) {
      const index = dayIndex.get(row.day)
      if (index === undefined) continue
      seriesOf(Number(row.product_id)).lost[index] += Number(row.lost)
    }

    const deliveriesByProduct = new Map<number, DeliveryRow[]>()
    for (const row of deliveryRows.rows) {
      const delivery: DeliveryRow = {
        productId: Number(row.product_id),
        supplierId: Number(row.supplier_id),
        amountSupplied: Number(row.amount_supplied),
        price: Number(row.price),
        purchasePrice: row.purchase_price === null ? null : Number(row.purchase_price),
        createdAt: new Date(row.created_at).getTime(),
        dayIndex: dayIndex.get(row.day) ?? null,
      }
      const bucket = deliveriesByProduct.get(delivery.productId) ?? []
      bucket.push(delivery)
      deliveriesByProduct.set(delivery.productId, bucket)
      if (delivery.dayIndex !== null) {
        seriesOf(delivery.productId).supplied[delivery.dayIndex] += delivery.amountSupplied
      }
    }

    const stockByProduct = new Map(
      stockRows.rows.map((r) => [Number(r.product_id), Number(r.stock)])
    )
    const favoritesByProduct = new Map(
      favoriteRows.rows.map((r) => [Number(r.product_id), Number(r.favorites)])
    )

    // ── Calendar: which days the fridge is in use ──
    const open = traffic.map((count) => count > 0)
    const weekdayOf = (index: number) => windowStart.plus({ days: index }).weekday % 7
    const pastDays = Array.from({ length: dayCount - 1 }, (_, index) => ({
      weekday: weekdayOf(index),
      open: open[index],
    }))
    const openProbability = openProbabilityByWeekday(pastDays)
    const weekly = openProbability.reduce((sum, p) => sum + p, 0)

    // ── Horizon: the supplier's habit, unless they moved the slider ──
    const ownTrips = [...deliveryRows.rows]
      .filter(
        (row) =>
          Number(row.supplier_id) === supplier.id &&
          new Date(row.created_at).getTime() >= today.minus({ days: STAPLE_WINDOW_DAYS }).toMillis()
      )
      .map((row) => new Date(row.created_at).getTime())
    const autoHorizonDays = defaultHorizonDays(tripCadenceDays(ownTrips))
    const horizonDays = chosenHorizon ? clampHorizon(chosenHorizon) : autoHorizonDays
    const openDaysInHorizon = expectedOpenDays(horizonDays, now.weekday % 7, openProbability)

    const ctx: Context = {
      supplierId: supplier.id,
      marginPercent,
      dayCount,
      open,
      weekly,
      avgOpenPerDay: weekly / 7,
      openDaysInHorizon,
      horizonDays,
      stapleSince: today.minus({ days: STAPLE_WINDOW_DAYS }).toMillis(),
    }

    // ── Products and groups in play ──
    const itemProductIds = items.filter((i) => i.productId).map((i) => i.productId!)
    const itemGroupIds = items.filter((i) => i.productGroupId).map((i) => i.productGroupId!)
    const productIds = new Set<number>([
      ...deliveriesByProduct.keys(),
      ...stockByProduct.keys(),
      ...itemProductIds,
    ])
    const products = productIds.size
      ? await Product.query()
          .whereIn('id', [...productIds])
          .preload('category')
      : []
    const groupIds = new Set<number>([
      ...products.filter((p) => p.productGroupId).map((p) => p.productGroupId!),
      ...itemGroupIds,
    ])
    const groups = groupIds.size
      ? await ProductGroup.query()
          .whereIn('id', [...groupIds])
          .preload('category')
      : []

    const statsCache = new Map<number, ItemStats>()
    const productStats = (productId: number): ItemStats => {
      const cached = statsCache.get(productId)
      if (cached) return cached
      const s = series.get(productId)
      const stock = stockByProduct.get(productId) ?? 0
      const deliveries = deliveriesByProduct.get(productId) ?? []
      const stats: ItemStats = {
        stock,
        rate: s ? estimateRate(this.observations(s, stock, ctx)) : 0,
        soldInWindow: s ? s.sold.reduce((sum, n) => sum + n, 0) : 0,
        deliveries,
      }
      statsCache.set(productId, stats)
      return stats
    }

    const itemByKey = new Map<string, ShoppingListItem>()
    for (const item of items) {
      if (item.kind === 'group' && item.productGroupId)
        itemByKey.set(`g-${item.productGroupId}`, item)
      if (item.kind === 'product' && item.productId) itemByKey.set(`p-${item.productId}`, item)
      if (item.kind === 'custom') itemByKey.set(`c-${item.id}`, item)
    }

    const inCategory = (categoryId: number | null) =>
      categoryIds.length === 0 || (categoryId !== null && categoryIds.includes(categoryId))
    const deliveredByMe = (deliveries: DeliveryRow[]) =>
      deliveries.some((d) => d.supplierId === ctx.supplierId && d.createdAt >= ctx.stapleSince)

    const suggestions: ShoppingLine[] = []
    const explicit: ShoppingLine[] = []

    // Group lines.
    for (const group of groups) {
      // Archived products are no longer bought — not a member to plan or hint at.
      const members = products.filter((p) => p.productGroupId === group.id && !p.archivedAt)
      const memberStats = members.map((p) => ({ product: p, stats: productStats(p.id) }))
      const deliveries = memberStats
        .flatMap((m) => m.stats.deliveries)
        .sort((a, b) => b.createdAt - a.createdAt)
      const inScope = scope === 'all' || deliveredByMe(deliveries)
      const item = itemByKey.get(`g-${group.id}`)
      if (!item && (!inScope || !inCategory(group.categoryId))) continue

      const summed: Series = {
        sold: new Array(dayCount).fill(0),
        supplied: new Array(dayCount).fill(0),
        lost: new Array(dayCount).fill(0),
      }
      for (const member of members) {
        const s = series.get(member.id)
        if (!s) continue
        for (let i = 0; i < dayCount; i++) {
          summed.sold[i] += s.sold[i]
          summed.supplied[i] += s.supplied[i]
          summed.lost[i] += s.lost[i]
        }
      }
      const stock = memberStats.reduce((sum, m) => sum + m.stats.stock, 0)
      const rate = estimateRate(this.observations(summed, stock, ctx))
      // A product of the group picked explicitly (a customer's wish) counts as bought.
      const planned = members.reduce((sum, member) => {
        const pick = itemByKey.get(`p-${member.id}`)
        return pick && !pick.isRemoved ? sum + (pick.quantity ?? 0) : sum
      }, 0)

      const hints = memberStats
        .map((m) => ({
          productId: m.product.id,
          name: m.product.displayName,
          stock: m.stats.stock,
          sold: m.stats.soldInWindow,
          favorites: favoritesByProduct.get(m.product.id) ?? 0,
        }))
        .filter((h) => h.sold > 0 || h.stock > 0 || h.favorites > 0)
        .sort(
          (a, b) => b.sold - a.sold || b.favorites - a.favorites || a.name.localeCompare(b.name)
        )
        .slice(0, HINT_COUNT)

      suggestions.push(
        this.makeLine(ctx, {
          key: `g-${group.id}`,
          kind: 'group',
          groupId: group.id,
          productId: null,
          name: group.name,
          categoryId: group.categoryId,
          categoryName: group.category?.name ?? null,
          categoryColor: group.category?.color ?? null,
          note: group.note,
          stock,
          plannedStock: stock + planned,
          rate,
          deliveries,
          hints,
          item,
          suggestible: true,
        })
      )
    }

    // Stand-alone products: staples on their own, plus every product the supplier added.
    for (const product of products) {
      const key = `p-${product.id}`
      const item = itemByKey.get(key)
      const stats = productStats(product.id)
      const recentDeliveries = stats.deliveries.filter((d) => d.createdAt >= ctx.stapleSince).length
      const isStaple =
        !product.productGroupId &&
        !product.archivedAt &&
        recentDeliveries >= STAPLE_MIN_DELIVERIES &&
        stats.soldInWindow >= STAPLE_MIN_SOLD
      const suggested =
        isStaple &&
        (scope === 'all' || deliveredByMe(stats.deliveries)) &&
        inCategory(product.categoryId)
      if (!suggested && !item) continue

      const line = this.makeLine(ctx, {
        key,
        kind: 'product',
        groupId: product.productGroupId,
        productId: product.id,
        name: product.displayName,
        categoryId: product.categoryId,
        categoryName: product.category?.name ?? null,
        categoryColor: product.category?.color ?? null,
        note: null,
        stock: stats.stock,
        plannedStock: stats.stock,
        rate: stats.rate,
        deliveries: stats.deliveries,
        hints: [],
        item,
        suggestible: suggested,
      })
      if (suggested) suggestions.push(line)
      else explicit.push(line)
    }

    // Own lines that are not in the catalogue.
    const custom: ShoppingLine[] = items
      .filter((item) => item.kind === 'custom')
      .map((item) => {
        const quantity = item.quantity ?? 0
        const unitCost = item.unitCost
        return {
          key: `c-${item.id}`,
          kind: 'custom' as const,
          groupId: null,
          productId: null,
          name: item.label ?? '',
          categoryId: null,
          categoryName: null,
          categoryColor: null,
          note: item.note,
          stock: null,
          weeklyRate: null,
          daysOfCover: null,
          stockoutRisk: null,
          demand: null,
          suggestedQuantity: 0,
          quantity,
          isOverridden: true,
          packSize: 1,
          packSample: [],
          unitCost,
          costSource: unitCost === null ? null : ('manual' as const),
          goodPrice: null,
          sellingPrice: unitCost === null ? null : suggestSellingPrice(unitCost, marginPercent),
          lineTotal: unitCost === null ? null : roundMoney(unitCost * quantity),
          isChecked: item.isChecked,
          isRemoved: false,
          hints: [],
          reasons: ['added' as const],
        }
      })

    const byUrgency = (a: ShoppingLine, b: ShoppingLine) =>
      (b.stockoutRisk ?? 0) - (a.stockoutRisk ?? 0) ||
      (b.weeklyRate ?? 0) - (a.weeklyRate ?? 0) ||
      a.name.localeCompare(b.name, 'cs')

    const lines = [
      ...[...suggestions, ...explicit]
        .filter((line) => !line.isRemoved && (line.quantity > 0 || line.reasons.includes('added')))
        .sort(byUrgency),
      ...custom,
    ]
    const covered = suggestions
      .filter((line) => !line.isRemoved && line.quantity === 0 && !line.reasons.includes('added'))
      .sort(byUrgency)
    const removed = suggestions.filter((line) => line.isRemoved).sort(byUrgency)

    return {
      settings: {
        horizonDays,
        autoHorizonDays,
        horizonIsAuto: !chosenHorizon,
        scope,
        categoryIds,
      },
      openDaysInHorizon: roundMoney(openDaysInHorizon),
      lines,
      covered,
      removed,
      totals: {
        lines: lines.length,
        pieces: lines.reduce((sum, line) => sum + line.quantity, 0),
        cost: roundMoney(lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0)),
        checked: lines.filter((line) => line.isChecked).length,
        linesWithoutCost: lines.filter((line) => line.quantity > 0 && line.unitCost === null)
          .length,
      },
      marginPercent,
    }
  }

  /** Day-by-day availability, rebuilt backwards from today's stock. */
  private observations(series: Series, stockNow: number, ctx: Context): DayObservation[] {
    const observations: DayObservation[] = []
    let endOfDay = stockNow
    for (let i = ctx.dayCount - 1; i >= 0; i--) {
      const startOfDay = endOfDay - series.supplied[i] + series.sold[i] + series.lost[i]
      // Today is still running — it tells nothing yet about a whole day's sales.
      if (i < ctx.dayCount - 1) {
        observations.push({
          ageDays: ctx.dayCount - 1 - i,
          open: ctx.open[i],
          available: startOfDay > 0 || series.supplied[i] > 0 || series.sold[i] > 0,
          sold: series.sold[i],
        })
      }
      endOfDay = startOfDay
    }
    return observations
  }

  private makeLine(
    ctx: Context,
    input: {
      key: string
      kind: 'group' | 'product'
      groupId: number | null
      productId: number | null
      name: string
      categoryId: number | null
      categoryName: string | null
      categoryColor: string | null
      note: string | null
      stock: number
      /** Stock plus what is already planned elsewhere on the list. */
      plannedStock: number
      rate: number
      deliveries: DeliveryRow[]
      hints: ShoppingLineHint[]
      item: ShoppingListItem | undefined
      suggestible: boolean
    }
  ): ShoppingLine {
    const packAmounts = input.deliveries.slice(0, PRICE_SAMPLE_LOTS).map((d) => d.amountSupplied)
    const packSize = inferPackSize(packAmounts)
    const suggestion = suggestQuantity({
      ratePerOpenDay: input.rate,
      openDays: ctx.openDaysInHorizon,
      stock: input.plannedStock,
      packSize,
    })
    const suggestedQuantity = input.suggestible ? suggestion.quantity : 0
    const item = input.item
    const quantity = item?.quantity ?? suggestedQuantity
    const prices = this.priceStats(input.deliveries, ctx.supplierId)
    const unitCost = item?.unitCost ?? prices.expected
    const costSource: CostSource | null =
      item?.unitCost !== null && item?.unitCost !== undefined ? 'manual' : prices.source
    const sellingPrice =
      unitCost === null
        ? null
        : costSource === 'selling'
          ? Math.round(unitCost)
          : suggestSellingPrice(unitCost, ctx.marginPercent)

    const daysOfCover =
      input.rate > 0 && ctx.avgOpenPerDay > 0
        ? Math.round((input.stock / (input.rate * ctx.avgOpenPerDay)) * 10) / 10
        : null
    const reasons: LineReason[] = []
    if (input.stock <= 0 && (input.rate > 0 || input.suggestible)) reasons.push('out_of_stock')
    else if (daysOfCover !== null && daysOfCover < ctx.horizonDays) reasons.push('runs_out')
    if (!input.suggestible) reasons.push('added')

    return {
      key: input.key,
      kind: input.kind,
      groupId: input.groupId,
      productId: input.productId,
      name: input.name,
      categoryId: input.categoryId,
      categoryName: input.categoryName,
      categoryColor: input.categoryColor,
      note: item?.note ?? input.note,
      stock: input.stock,
      weeklyRate: Math.round(input.rate * ctx.weekly * 10) / 10,
      daysOfCover,
      stockoutRisk:
        Math.round(stockoutRisk(input.stock, input.rate * ctx.openDaysInHorizon) * 100) / 100,
      demand: Math.round(suggestion.demand * 10) / 10,
      suggestedQuantity,
      quantity,
      isOverridden: item?.quantity !== null && item?.quantity !== undefined,
      packSize,
      packSample: packSize > 1 ? packAmounts.slice(0, 5) : [],
      unitCost: unitCost === null ? null : roundMoney(unitCost),
      costSource: unitCost === null ? null : costSource,
      // Within a group the cheapest quarter is just the cheapest product, not a promotion.
      goodPrice: input.kind === 'group' ? null : prices.good,
      sellingPrice,
      lineTotal: unitCost === null ? null : roundMoney(unitCost * quantity),
      isChecked: item?.isChecked ?? false,
      isRemoved: item?.isRemoved ?? false,
      hints: input.hints,
      reasons,
    }
  }

  /**
   * Expected price per piece: what the supplier paid lately (or, without purchase prices of
   * their own, what the product sold for). The "good" price is the cheapest quarter of the
   * year. A colleague's purchase prices are theirs — they never feed someone else's list,
   * not even an admin's; selling prices are public and may come from anyone's lots.
   */
  private priceStats(
    deliveries: DeliveryRow[],
    supplierId: number
  ): {
    expected: number | null
    good: number | null
    source: 'purchase' | 'selling' | null
  } {
    const withCost = deliveries.filter(
      (d) => d.purchasePrice !== null && d.supplierId === supplierId
    )
    const pool = withCost.length ? withCost : deliveries
    if (pool.length === 0) return { expected: null, good: null, source: null }
    const valueOf = (d: DeliveryRow) => (withCost.length ? d.purchasePrice! : d.price)
    const expected = weightedMedian(
      pool.slice(0, PRICE_SAMPLE_LOTS).map((d) => ({ value: valueOf(d), weight: d.amountSupplied }))
    )
    const quartile = pool.length >= 3 ? percentile(pool.map(valueOf), 25) : null
    return {
      expected,
      good: quartile !== null && expected !== null && quartile < expected ? quartile : null,
      source: withCost.length ? 'purchase' : 'selling',
    }
  }

  private async itemFor(
    list: ShoppingList,
    ref: { kind: LineKind; id: number },
    create: true
  ): Promise<ShoppingListItem>
  private async itemFor(
    list: ShoppingList,
    ref: { kind: LineKind; id: number },
    create: false
  ): Promise<ShoppingListItem | null>
  private async itemFor(
    list: ShoppingList,
    ref: { kind: LineKind; id: number },
    create: boolean
  ): Promise<ShoppingListItem | null> {
    if (ref.kind === 'custom') {
      const item = await ShoppingListItem.query()
        .where('shoppingListId', list.id)
        .where('kind', 'custom')
        .where('id', ref.id)
        .first()
      if (!item && create) throw new DomainError<ShoppingListErrorCode>('LINE_NOT_FOUND')
      return item
    }

    const column = ref.kind === 'group' ? 'productGroupId' : 'productId'
    const existing = await ShoppingListItem.query()
      .where('shoppingListId', list.id)
      .where('kind', ref.kind)
      .where(column, ref.id)
      .first()
    if (existing || !create) return existing

    if (ref.kind === 'group' && !(await ProductGroup.find(ref.id))) {
      throw new DomainError<ShoppingListErrorCode>('GROUP_NOT_FOUND')
    }
    if (ref.kind === 'product' && !(await Product.find(ref.id))) {
      throw new DomainError<ShoppingListErrorCode>('PRODUCT_NOT_FOUND')
    }
    try {
      return await ShoppingListItem.create({
        shoppingListId: list.id,
        kind: ref.kind,
        productGroupId: ref.kind === 'group' ? ref.id : null,
        productId: ref.kind === 'product' ? ref.id : null,
        quantity: null,
        unitCost: null,
        isRemoved: false,
        isChecked: false,
      })
    } catch (err) {
      // Two tabs touched the same line at once — the partial unique index let one of them
      // create it, so the other one works with that row.
      if (!isUniqueViolation(err)) throw err
      const winner = await ShoppingListItem.query()
        .where('shoppingListId', list.id)
        .where('kind', ref.kind)
        .where(column, ref.id)
        .first()
      if (!winner) throw err
      return winner
    }
  }
}
