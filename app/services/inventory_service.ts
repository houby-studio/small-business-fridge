import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Delivery from '#models/delivery'
import DeliveryService from '#services/delivery_service'
import InventoryCount, { type InventoryScope } from '#models/inventory_count'
import InventoryCountItem from '#models/inventory_count_item'
import StockAdjustment, { type StockAdjustmentReason } from '#models/stock_adjustment'
import Product from '#models/product'
import type User from '#models/user'
import AuditService from '#services/audit_service'
import { DomainError } from '#services/domain_error'
import { normalizeImagePath } from '#helpers/image_url'
import { roundMoney } from '#services/shopping/pricing'
import { planFifoTake } from '#services/stock_fifo'
import NotificationService from '#services/notification_service'
import { runAfterResponse } from '#services/side_effects'

export type InventoryErrorCode =
  | 'PRODUCT_NOT_FOUND'
  | 'NOT_ENOUGH_STOCK'
  | 'NOTHING_COUNTED'
  | 'NOTHING_TO_CLASSIFY'
  | 'FORBIDDEN'
  | 'ADJUSTMENT_NOT_FOUND'
  | 'NOT_A_WRITE_OFF'
  | 'ALREADY_REVERTED'
  | 'REVERT_TOO_LATE'
  | 'DELIVERY_VOIDED'

export type WriteOffReason = Exclude<StockAdjustmentReason, 'inventory'>

type Actor = Pick<User, 'id' | 'role'>

export interface InventoryCountInput {
  productId: number
  /**
   * System stock the counter saw. Omitted, the current stock of the whole fridge is used —
   * right for a count dictated just now.
   */
  expected?: number
  counted: number
  /**
   * When `expected` was read (the sheet's `stockAsOf`). With it, what moved the stock
   * between then and the count is taken into account, see `expectedAtCount`.
   */
  asOf?: Date | null
  /** When the product was counted; defaults to now. */
  countedAt?: Date | null
}

/** How long a mistaken write-off can be taken back. */
export const WRITE_OFF_REVERT_DAYS = 7

/**
 * Whether `actor` may take this write-off back: a manual write-off (not an inventory
 * difference) that is not reverted yet, at most a week old, by its author or an admin.
 * Whether its lot is still live is checked when it is reverted.
 */
export function canRevertWriteOff(
  adjustment: {
    kind: string
    inventoryCountId: number | null
    revertedAt: unknown
    actorId: number
    createdAt: Date
  },
  actor: Actor,
  now = new Date()
): boolean {
  return (
    adjustment.kind === 'loss' &&
    adjustment.inventoryCountId === null &&
    !adjustment.revertedAt &&
    (actor.role === 'admin' || adjustment.actorId === actor.id) &&
    now.getTime() - adjustment.createdAt.getTime() <= WRITE_OFF_REVERT_DAYS * 86_400_000
  )
}

/** Products a supplier delivered lately are on the sheet even at zero — the shelf may disagree. */
const RECENT_DELIVERY_DAYS = 90

interface AppliedChange {
  supplierId: number
  productId: number
  kind: 'loss' | 'surplus'
  quantity: number
  unitCost: number | null
  unitPrice: number
}

/**
 * Shrinkage: write-offs of pieces the supplier knows about (damaged, expired, stolen), and
 * inventories that compare the shelf with the system — their shortfall starts without a
 * reason and can be given one afterwards. Losses come off the oldest lots first — exactly the
 * pieces FIFO would have sold next, so an unpaid snack costs whoever's lot a paid one would have.
 */
export default class InventoryService {
  /**
   * Products for an inventory: the actor's own lots ("mine") or the whole fridge. Besides
   * everything in stock, products delivered in the last 90 days are listed at zero — the
   * shelf may still hold some (a cancelled order, a kiosk mistake). Sorted the way the
   * fridge is walked: by category (A–Z, products without one last), then by name — both in
   * Czech order, so "Čokoláda" comes after "Cola", not after "Z".
   */
  async getCountableProducts(actor: Actor, scope: InventoryScope, categoryId?: number) {
    const recentSince = DateTime.now().minus({ days: RECENT_DELIVERY_DAYS }).toJSDate()
    const query = db
      .from('deliveries')
      .join('products', 'products.id', 'deliveries.product_id')
      .leftJoin('categories', 'categories.id', 'products.category_id')
      .whereNull('deliveries.voided_at')
      // An archived product has no stock left — nothing to count.
      .whereNull('products.archived_at')
      .groupBy(
        'products.id',
        'products.display_name',
        'products.image_path',
        'categories.name',
        'categories.color'
      )
      .havingRaw('SUM(deliveries.amount_left) > 0 OR MAX(deliveries.created_at) >= ?', [
        recentSince,
      ])
      .select(
        'products.id as product_id',
        'products.display_name',
        'products.image_path',
        'categories.name as category_name',
        'categories.color as category_color'
      )
      .select(db.raw('SUM(deliveries.amount_left)::int as stock'))

    if (categoryId) query.where('products.category_id', categoryId)
    if (scope === 'mine') {
      query.whereIn(
        'products.id',
        db
          .from('deliveries')
          .where('supplier_id', actor.id)
          .whereNull('voided_at')
          .where((q) => q.where('amount_left', '>', 0).orWhere('created_at', '>=', recentSince))
          .select('product_id')
      )
    }

    const rows = await query
    const collator = new Intl.Collator('cs', { sensitivity: 'base', numeric: true })
    return rows
      .map((row) => ({
        productId: Number(row.product_id),
        productName: row.display_name as string,
        imagePath: normalizeImagePath(row.image_path),
        categoryName: (row.category_name as string | null) ?? null,
        categoryColor: (row.category_color as string | null) ?? null,
        stock: Number(row.stock),
      }))
      .sort(
        (a, b) =>
          Number(a.categoryName === null) - Number(b.categoryName === null) ||
          collator.compare(a.categoryName ?? '', b.categoryName ?? '') ||
          collator.compare(a.productName, b.productName) ||
          a.productId - b.productId
      )
  }

  /** Writes off damaged, expired or otherwise lost pieces of one product. */
  async writeOff(
    actor: Actor,
    input: { productId: number; quantity: number; reason: WriteOffReason; note?: string | null },
    options: { impersonatorId?: number } = {}
  ): Promise<StockAdjustment[]> {
    const product = await Product.find(input.productId)
    if (!product) throw new DomainError<InventoryErrorCode>('PRODUCT_NOT_FOUND')

    const created = await db.transaction(async (trx) => {
      const lots = await this.lockLots(input.productId, trx)
      const available = lots.reduce((sum, lot) => sum + lot.amountLeft, 0)
      if (available < input.quantity) {
        throw new DomainError<InventoryErrorCode>('NOT_ENOUGH_STOCK')
      }
      const applied = await this.takeLoss(lots, input.quantity, trx)
      const rows = await this.record(applied.lots, {
        actor,
        productId: input.productId,
        reason: input.reason,
        note: input.note ?? null,
        impersonatorId: options.impersonatorId ?? null,
        inventoryCountId: null,
        trx,
      })
      await this.auditPerSupplier(
        actor,
        'stock.written_off',
        'product',
        input.productId,
        applied.changes,
        {
          productId: input.productId,
          productName: product.displayName,
          reason: input.reason,
          ...(input.note && { note: input.note }),
        },
        { client: trx }
      )
      return rows
    })

    // FIFO may reach a colleague's lots: each of them gets one e-mail about this write-off.
    const byOwner = new Map<number, Array<{ deliveryId: number; quantity: number }>>()
    for (const row of created) {
      if (row.supplierId === actor.id) continue
      byOwner.set(row.supplierId, [
        ...(byOwner.get(row.supplierId) ?? []),
        { deliveryId: row.deliveryId, quantity: row.quantity },
      ])
    }
    for (const [supplierId, lots] of byOwner) {
      runAfterResponse(
        () =>
          new NotificationService().sendWriteOffToSupplier({
            supplierId,
            actorId: options.impersonatorId ?? actor.id,
            productId: input.productId,
            reason: input.reason,
            note: input.note ?? null,
            lots,
          }),
        `write-off notice for supplier #${supplierId}`
      )
    }
    return created
  }

  /**
   * Takes a mistaken write-off back: the pieces return onto the very lot they came off and
   * the row stays in the history marked as reverted, so it no longer counts as shrinkage.
   * Only a manual write-off, at most `WRITE_OFF_REVERT_DAYS` old, by its author or an
   * admin, while its lot is not voided — an inventory difference is corrected by the next
   * inventory instead.
   */
  async revertWriteOff(actor: Actor, adjustmentId: number): Promise<StockAdjustment> {
    return db.transaction(async (trx) => {
      const adjustment = await StockAdjustment.query({ client: trx })
        .where('id', adjustmentId)
        .forUpdate()
        .first()
      if (!adjustment) throw new DomainError<InventoryErrorCode>('ADJUSTMENT_NOT_FOUND')
      if (adjustment.kind !== 'loss' || adjustment.inventoryCountId !== null) {
        throw new DomainError<InventoryErrorCode>('NOT_A_WRITE_OFF')
      }
      if (adjustment.revertedAt) throw new DomainError<InventoryErrorCode>('ALREADY_REVERTED')
      if (actor.role !== 'admin' && adjustment.actorId !== actor.id) {
        throw new DomainError<InventoryErrorCode>('FORBIDDEN')
      }
      const check = {
        kind: adjustment.kind,
        inventoryCountId: adjustment.inventoryCountId,
        revertedAt: null,
        actorId: adjustment.actorId,
        createdAt: adjustment.createdAt.toJSDate(),
      }
      if (!canRevertWriteOff(check, actor)) {
        throw new DomainError<InventoryErrorCode>('REVERT_TOO_LATE')
      }

      // The same lock order as a purchase: all lots of the product, oldest first.
      const lots = await this.lockLots(adjustment.productId, trx)
      const lot = lots.find((l) => l.id === adjustment.deliveryId)
      if (!lot) throw new DomainError<InventoryErrorCode>('DELIVERY_VOIDED')
      // The pieces come off the lost side of their lot, and go back to whoever holds its
      // stock now — the lot itself, or the heir's lot when the stock was handed over.
      lot.amountLost -= adjustment.quantity
      await lot.useTransaction(trx).save()
      const target = await new DeliveryService().returnPieces(lot.id, adjustment.quantity, trx)

      adjustment.useTransaction(trx)
      adjustment.revertedAt = DateTime.now()
      adjustment.revertedBy = actor.id
      await adjustment.save()

      const product = await Product.find(adjustment.productId, { client: trx })
      await AuditService.log(
        actor.id,
        'stock.write_off_reverted',
        'stock_adjustment',
        adjustment.id,
        adjustment.supplierId === actor.id ? null : adjustment.supplierId,
        {
          productId: adjustment.productId,
          productName: product?.displayName ?? null,
          deliveryId: adjustment.deliveryId,
          ...(target.id !== adjustment.deliveryId && { returnedToDeliveryId: target.id }),
          quantity: adjustment.quantity,
          reason: adjustment.reason,
        },
        { client: trx }
      )
      return adjustment
    })
  }

  /**
   * Commits an inventory: every counted product whose count differs from the stock at the
   * moment it was counted is corrected — missing pieces are written off FIFO, extra pieces
   * go back onto a lot of whoever counted. Sales after counting stay untouched.
   *
   * The sheet is loaded long before the last product is counted, and the fridge keeps
   * selling meanwhile. So when an item says when its `expected` was read (`asOf`), the
   * stock is moved on to the moment of counting: sales, deliveries and write-offs between
   * `asOf` and `countedAt` happened on the shelf too, and corrections other inventories
   * committed since `asOf` fixed the same difference already.
   */
  async commitCount(
    actor: Actor,
    input: { scope: InventoryScope; note?: string | null; items: InventoryCountInput[] },
    options: { impersonatorId?: number } = {}
  ): Promise<InventoryCount> {
    const counted = [...new Map(input.items.map((item) => [item.productId, item])).values()].sort(
      (a, b) => a.productId - b.productId
    )
    if (counted.length === 0) throw new DomainError<InventoryErrorCode>('NOTHING_COUNTED')

    const products = await Product.query().whereIn(
      'id',
      counted.map((item) => item.productId)
    )
    if (products.length !== counted.length) {
      throw new DomainError<InventoryErrorCode>('PRODUCT_NOT_FOUND')
    }

    const committed = await db.transaction(async (trx) => {
      const allChanges: AppliedChange[] = []
      const created = await InventoryCount.create(
        {
          actorId: actor.id,
          impersonatorId: options.impersonatorId ?? null,
          scope: input.scope,
          note: input.note?.trim() || null,
        },
        { client: trx }
      )

      // Products in id order, like every other lot lock — two counts cannot deadlock. The
      // lots are locked before the stock is read, so a purchase cannot slip in between.
      for (const item of counted) {
        const lots = await this.lockLots(item.productId, trx)
        const stockNow = lots.reduce((sum, lot) => sum + lot.amountLeft, 0)
        const expected =
          item.expected === undefined
            ? stockNow
            : await this.expectedAtCount(item.productId, item.expected, item, created.id, trx)
        const difference = item.counted - expected
        let appliedQty = 0
        if (difference !== 0) {
          const applied =
            difference < 0
              ? await this.takeLoss(lots, -difference, trx)
              : await this.addSurplus(lots, difference, actor.id, trx)
          appliedQty = applied.changes.reduce(
            (sum, change) => sum + (change.kind === 'loss' ? -change.quantity : change.quantity),
            0
          )
          await this.record(applied.lots, {
            actor,
            productId: item.productId,
            reason: 'inventory',
            note: null,
            impersonatorId: options.impersonatorId ?? null,
            inventoryCountId: created.id,
            trx,
          })
          allChanges.push(...applied.changes)
        }
        await InventoryCountItem.create(
          {
            inventoryCountId: created.id,
            productId: item.productId,
            expectedQty: expected,
            sheetQty:
              item.expected !== undefined && item.expected !== expected ? item.expected : null,
            countedQty: item.counted,
            appliedQty,
          },
          { client: trx }
        )
      }

      const loss = allChanges.filter((c) => c.kind === 'loss')
      const surplus = allChanges.filter((c) => c.kind === 'surplus')
      await AuditService.log(
        actor.id,
        'inventory.committed',
        'inventory_count',
        created.id,
        null,
        {
          scope: input.scope,
          products: counted.length,
          lossQuantity: loss.reduce((sum, c) => sum + c.quantity, 0),
          surplusQuantity: surplus.reduce((sum, c) => sum + c.quantity, 0),
          lossValue: loss.reduce((sum, c) => sum + c.quantity * c.unitPrice, 0),
          lossCost: roundMoney(
            loss.reduce((sum, c) => sum + c.quantity * (c.unitCost ?? c.unitPrice), 0)
          ),
        },
        { client: trx }
      )
      await this.auditPerSupplier(
        actor,
        'stock.adjusted',
        'inventory_count',
        created.id,
        allChanges.filter((c) => c.supplierId !== actor.id),
        { inventoryCountId: created.id },
        { client: trx }
      )
      return { created, allChanges }
    })

    const { created, allChanges } = committed
    // Every colleague whose lots the count changed gets one summary — never the counter.
    const byOwner = new Map<
      number,
      Map<string, { productId: number; kind: 'loss' | 'surplus'; quantity: number }>
    >()
    for (const change of allChanges) {
      if (change.supplierId === actor.id) continue
      const items = byOwner.get(change.supplierId) ?? new Map()
      const key = `${change.productId}:${change.kind}`
      const item = items.get(key) ?? { productId: change.productId, kind: change.kind, quantity: 0 }
      item.quantity += change.quantity
      items.set(key, item)
      byOwner.set(change.supplierId, items)
    }
    for (const [supplierId, items] of byOwner) {
      runAfterResponse(
        () =>
          new NotificationService().sendInventoryToSupplier({
            supplierId,
            actorId: options.impersonatorId ?? actor.id,
            inventoryCountId: created.id,
            items: [...items.values()],
          }),
        `inventory #${created.id} summary for supplier #${supplierId}`
      )
    }
    return created
  }

  /**
   * The stock a product had when it was counted, from what the sheet showed at `asOf`:
   * the shelf changed by the sales, deliveries and write-offs in between, and the system
   * number by the corrections made since — other inventories, reverted write-offs and
   * cancelled purchases the sheet already showed fixed the very difference this count would
   * find again. Voided deliveries and delivery corrections are
   * not replayed (rare, and a correction changes the books, not the shelf).
   */
  private async expectedAtCount(
    productId: number,
    sheetStock: number,
    item: InventoryCountInput,
    countId: number,
    trx: TransactionClientContract
  ): Promise<number> {
    if (!item.asOf) return sheetStock
    const now = new Date()
    const asOf = item.asOf > now ? now : item.asOf
    const countedAt =
      !item.countedAt || item.countedAt > now ? now : item.countedAt < asOf ? asOf : item.countedAt

    const [sales, deliveries, adjustments, reverts, stornos] = await Promise.all([
      trx
        .from('orders')
        .join('deliveries', 'deliveries.id', 'orders.delivery_id')
        .where('deliveries.product_id', productId)
        .where('orders.created_at', '>', asOf)
        .where('orders.created_at', '<=', countedAt)
        .count('* as n')
        .first(),
      trx
        .from('deliveries')
        .where('product_id', productId)
        .whereNull('voided_at')
        .where('created_at', '>', asOf)
        .where('created_at', '<=', countedAt)
        .sum('amount_supplied as n')
        .first(),
      // Write-offs in the window happened on the shelf; other counts since asOf are
      // corrections of the system number. A write-off made and reverted after asOf was a
      // mistake on both sides — it cancels out.
      trx
        .from('stock_adjustments')
        .where('product_id', productId)
        .whereNull('reverted_at')
        .where('created_at', '>', asOf)
        .where((q) => q.whereNot('inventory_count_id', countId).orWhereNull('inventory_count_id'))
        .where((q) => q.whereNotNull('inventory_count_id').orWhere('created_at', '<=', countedAt))
        .select(
          db.raw("COALESCE(SUM(CASE WHEN kind = 'loss' THEN -quantity ELSE quantity END), 0) AS n")
        )
        .first(),
      // A write-off the sheet already showed, reverted since: the pieces never left the
      // shelf, so the revert corrects the system number like another count would.
      trx
        .from('stock_adjustments')
        .where('product_id', productId)
        .where('kind', 'loss')
        .where('created_at', '<=', asOf)
        .where('reverted_at', '>', asOf)
        .sum('quantity as n')
        .first(),
      // Likewise a purchase the sheet already showed that was cancelled since. The order row
      // is deleted by a storno — the audit entry (same transaction) is its record.
      trx
        .from('audit_logs')
        .where('action', 'order.storno')
        .where('created_at', '>', asOf)
        .whereRaw("(metadata->>'productId')::int = ?", [productId])
        .whereRaw(
          "COALESCE((metadata->>'orderCreatedAt')::timestamptz, '-infinity'::timestamptz) <= ?",
          [asOf]
        )
        .count('* as n')
        .first(),
    ])

    const moved =
      -Number(sales?.n ?? 0) +
      Number(deliveries?.n ?? 0) +
      Number(adjustments?.n ?? 0) +
      Number(reverts?.n ?? 0) +
      Number(stornos?.n ?? 0)
    return Math.max(0, sheetStock + moved)
  }

  /**
   * Gives the shortfall an inventory found on one product a reason once it is known — the
   * pieces were stolen, had expired… Every loss row of that count and product changes
   * together (FIFO may have spread them over several lots); a surplus has nothing to explain.
   * Allowed for whoever counted, whoever owns one of the lots it came off, and admins.
   */
  async reclassifyCountLoss(
    actor: Actor,
    countId: number,
    productId: number,
    reason: StockAdjustmentReason
  ): Promise<{ productName: string | null; changed: boolean }> {
    return db.transaction(async (trx) => {
      const rows = await StockAdjustment.query({ client: trx })
        .where('inventoryCountId', countId)
        .where('productId', productId)
        .where('kind', 'loss')
        .orderBy('id', 'asc')
        .forUpdate()
      if (rows.length === 0) throw new DomainError<InventoryErrorCode>('NOTHING_TO_CLASSIFY')

      const count = await InventoryCount.find(countId, { client: trx })
      const allowed =
        actor.role === 'admin' ||
        count?.actorId === actor.id ||
        rows.some((row) => row.supplierId === actor.id)
      if (!allowed) throw new DomainError<InventoryErrorCode>('FORBIDDEN')

      const product = await Product.find(productId, { client: trx })
      const productName = product?.displayName ?? null
      const previous = [...new Set(rows.map((row) => row.reason))]
      if (previous.length === 1 && previous[0] === reason) return { productName, changed: false }

      await StockAdjustment.query({ client: trx })
        .whereIn(
          'id',
          rows.map((row) => row.id)
        )
        .update({ reason })

      await this.auditPerSupplier(
        actor,
        'stock.reclassified',
        'inventory_count',
        countId,
        rows.map((row) => ({
          supplierId: row.supplierId,
          productId: row.productId,
          kind: row.kind,
          quantity: row.quantity,
          unitCost: row.unitCost,
          unitPrice: row.unitPrice,
        })),
        {
          inventoryCountId: countId,
          productId,
          productName,
          from: previous.length === 1 ? previous[0] : previous,
          to: reason,
        },
        { client: trx }
      )
      return { productName, changed: true }
    })
  }

  /** Past inventories, newest first — everyone's, or only those `actorId` counted. */
  async listCounts(page: number, perPage: number, filters: { actorId?: number } = {}) {
    const query = InventoryCount.query()
      .preload('actor')
      .preload('items')
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
    if (filters.actorId) query.where('actorId', filters.actorId)
    const paginator = await query.paginate(page, perPage)
    const ids = paginator.all().map((c) => c.id)
    const values = ids.length
      ? await db
          .from('stock_adjustments')
          .whereIn('inventory_count_id', ids)
          .groupBy('inventory_count_id')
          .select('inventory_count_id')
          .select(
            db.raw(
              "COALESCE(SUM(quantity * unit_price) FILTER (WHERE kind = 'loss'), 0)::int AS loss_value"
            ),
            db.raw(
              "COALESCE(SUM(quantity * COALESCE(unit_cost, unit_price)) FILTER (WHERE kind = 'loss'), 0)::numeric AS loss_cost"
            )
          )
      : []
    const valueById = new Map(values.map((row) => [Number(row.inventory_count_id), row]))

    return {
      data: paginator.all().map((count) => {
        const value = valueById.get(count.id)
        return {
          id: count.id,
          createdAt: count.createdAt.toISO(),
          actorName: count.actor?.displayName ?? '—',
          scope: count.scope,
          note: count.note,
          products: count.items.length,
          lossQuantity: count.items.reduce((s, i) => s + Math.max(0, -i.appliedQty), 0),
          surplusQuantity: count.items.reduce((s, i) => s + Math.max(0, i.appliedQty), 0),
          lossValue: Number(value?.loss_value ?? 0),
          lossCost: roundMoney(Number(value?.loss_cost ?? 0)),
        }
      }),
      meta: paginator.getMeta(),
    }
  }

  async getCount(countId: number) {
    const count = await InventoryCount.query()
      .where('id', countId)
      .preload('actor')
      .preload('items', (q) => q.preload('product').orderBy('id', 'asc'))
      .preload('adjustments', (q) => q.preload('supplier').orderBy('id', 'asc'))
      .firstOrFail()
    return count
  }

  private async lockLots(productId: number, trx: TransactionClientContract) {
    // Same order as a purchase locks the lots of a product.
    const lock = () =>
      Delivery.query({ client: trx })
        .where('productId', productId)
        .whereNull('voidedAt')
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc')
        .forUpdate()
    await lock()
    // A statement only sees rows committed before it started. When it had to wait for a
    // handover (transferStock) to commit, the lot that handover created is missing from its
    // result — so once the locks are ours, read the lots again with a fresh snapshot.
    return lock()
  }

  /** Takes `quantity` pieces off the oldest lots that still have some. */
  private async takeLoss(lots: Delivery[], quantity: number, trx: TransactionClientContract) {
    // The same plan the write-off dialog previews (planFifoTake, mirrored in the frontend).
    const byId = new Map(lots.map((lot) => [lot.id, lot]))
    const touched: Array<{ lot: Delivery; kind: 'loss'; quantity: number }> = []
    for (const { id, take } of planFifoTake(lots, quantity)) {
      const lot = byId.get(id)!
      lot.amountLeft -= take
      lot.amountLost += take
      await lot.useTransaction(trx).save()
      touched.push({ lot, kind: 'loss', quantity: take })
    }
    return { lots: touched, changes: touched.map((t) => this.change(t)) }
  }

  /**
   * Puts found pieces back onto a lot of whoever counted — most likely theirs to begin
   * with — or, when they have none of this product, onto any lot. The newest lot something
   * already left is preferred: a lot nobody touched yet would end up holding more pieces
   * than were delivered.
   */
  private async addSurplus(
    lots: Delivery[],
    quantity: number,
    actorId: number,
    trx: TransactionClientContract
  ) {
    const touched = (l: Delivery) => l.amountLeft < l.amountSupplied
    const lot =
      lots.findLast((l) => l.supplierId === actorId && touched(l)) ??
      lots.findLast((l) => l.supplierId === actorId) ??
      lots.findLast(touched) ??
      lots[lots.length - 1]
    if (!lot) return { lots: [], changes: [] }
    lot.amountLeft += quantity
    lot.amountLost -= quantity
    await lot.useTransaction(trx).save()
    const changed = [{ lot, kind: 'surplus' as const, quantity }]
    return { lots: changed, changes: changed.map((t) => this.change(t)) }
  }

  private change(t: { lot: Delivery; kind: 'loss' | 'surplus'; quantity: number }): AppliedChange {
    return {
      supplierId: t.lot.supplierId,
      productId: t.lot.productId,
      kind: t.kind,
      quantity: t.quantity,
      unitCost: t.lot.purchasePrice,
      unitPrice: t.lot.price,
    }
  }

  private async record(
    touched: Array<{ lot: Delivery; kind: 'loss' | 'surplus'; quantity: number }>,
    context: {
      actor: Actor
      productId: number
      reason: StockAdjustmentReason
      note: string | null
      impersonatorId: number | null
      inventoryCountId: number | null
      trx: TransactionClientContract
    }
  ): Promise<StockAdjustment[]> {
    const created: StockAdjustment[] = []
    for (const t of touched) {
      created.push(
        await StockAdjustment.create(
          {
            deliveryId: t.lot.id,
            productId: context.productId,
            supplierId: t.lot.supplierId,
            actorId: context.actor.id,
            impersonatorId: context.impersonatorId,
            kind: t.kind,
            reason: context.reason,
            quantity: t.quantity,
            unitCost: t.lot.purchasePrice,
            unitPrice: t.lot.price,
            inventoryCountId: context.inventoryCountId,
            note: context.note?.trim() || null,
          },
          { client: context.trx }
        )
      )
    }
    return created
  }

  /**
   * One audit entry per supplier whose lots changed, aimed at them when it was not their
   * own doing — the shelf is shared, so a colleague's count can touch your stock.
   */
  private async auditPerSupplier(
    actor: Actor,
    action: string,
    entityType: string,
    entityId: number,
    changes: AppliedChange[],
    metadata: Record<string, unknown>,
    options: { client?: TransactionClientContract } = {}
  ) {
    const bySupplier = new Map<number, AppliedChange[]>()
    for (const change of changes) {
      bySupplier.set(change.supplierId, [...(bySupplier.get(change.supplierId) ?? []), change])
    }
    for (const [supplierId, list] of bySupplier) {
      await AuditService.log(
        actor.id,
        action,
        entityType,
        entityId,
        supplierId === actor.id ? null : supplierId,
        {
          ...metadata,
          lossQuantity: list.filter((c) => c.kind === 'loss').reduce((s, c) => s + c.quantity, 0),
          surplusQuantity: list
            .filter((c) => c.kind === 'surplus')
            .reduce((s, c) => s + c.quantity, 0),
        },
        options
      )
    }
  }
}
