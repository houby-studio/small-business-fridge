import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Delivery from '#models/delivery'
import InventoryCount, { type InventoryScope } from '#models/inventory_count'
import InventoryCountItem from '#models/inventory_count_item'
import StockAdjustment, { type StockAdjustmentReason } from '#models/stock_adjustment'
import Product from '#models/product'
import type User from '#models/user'
import AuditService from '#services/audit_service'
import { DomainError } from '#services/domain_error'
import { normalizeImagePath } from '#helpers/image_url'
import { roundMoney } from '#services/shopping/pricing'

export type InventoryErrorCode =
  | 'PRODUCT_NOT_FOUND'
  | 'NOT_ENOUGH_STOCK'
  | 'NOTHING_COUNTED'
  | 'NOTHING_TO_CLASSIFY'
  | 'FORBIDDEN'

export type WriteOffReason = Exclude<StockAdjustmentReason, 'inventory'>

type Actor = Pick<User, 'id' | 'role'>

export interface InventoryCountInput {
  productId: number
  /** System stock the counter saw when they counted — sales since then are not shrinkage. */
  expected: number
  counted: number
}

interface AppliedChange {
  supplierId: number
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
  /** Products with stock for an inventory: the actor's own lots ("mine") or the whole fridge. */
  async getCountableProducts(actor: Actor, scope: InventoryScope, categoryId?: number) {
    const query = db
      .from('deliveries')
      .join('products', 'products.id', 'deliveries.product_id')
      .leftJoin('categories', 'categories.id', 'products.category_id')
      .whereNull('deliveries.voided_at')
      .groupBy(
        'products.id',
        'products.display_name',
        'products.image_path',
        'categories.name',
        'categories.color'
      )
      .havingRaw('SUM(deliveries.amount_left) > 0')
      .select(
        'products.id as product_id',
        'products.display_name',
        'products.image_path',
        'categories.name as category_name',
        'categories.color as category_color'
      )
      .select(db.raw('SUM(deliveries.amount_left)::int as stock'))
      .orderBy('products.display_name', 'asc')

    if (categoryId) query.where('products.category_id', categoryId)
    if (scope === 'mine') {
      query.whereIn(
        'products.id',
        db
          .from('deliveries')
          .where('supplier_id', actor.id)
          .whereNull('voided_at')
          .where('amount_left', '>', 0)
          .select('product_id')
      )
    }

    const rows = await query
    return rows.map((row) => ({
      productId: Number(row.product_id),
      productName: row.display_name as string,
      imagePath: normalizeImagePath(row.image_path),
      categoryName: (row.category_name as string | null) ?? null,
      categoryColor: (row.category_color as string | null) ?? null,
      stock: Number(row.stock),
    }))
  }

  /** Writes off damaged, expired or otherwise lost pieces of one product. */
  async writeOff(
    actor: Actor,
    input: { productId: number; quantity: number; reason: WriteOffReason; note?: string | null },
    options: { impersonatorId?: number } = {}
  ): Promise<StockAdjustment[]> {
    const product = await Product.find(input.productId)
    if (!product) throw new DomainError<InventoryErrorCode>('PRODUCT_NOT_FOUND')

    const { adjustments, changes } = await db.transaction(async (trx) => {
      const lots = await this.lockLots(input.productId, trx)
      const available = lots.reduce((sum, lot) => sum + lot.amountLeft, 0)
      if (available < input.quantity) {
        throw new DomainError<InventoryErrorCode>('NOT_ENOUGH_STOCK')
      }
      const applied = await this.takeLoss(lots, input.quantity, trx)
      const created = await this.record(applied.lots, {
        actor,
        productId: input.productId,
        reason: input.reason,
        note: input.note ?? null,
        impersonatorId: options.impersonatorId ?? null,
        inventoryCountId: null,
        trx,
      })
      return { adjustments: created, changes: applied.changes }
    })

    await this.auditPerSupplier(actor, 'stock.written_off', 'product', input.productId, changes, {
      productId: input.productId,
      productName: product.displayName,
      reason: input.reason,
      ...(input.note && { note: input.note }),
    })
    return adjustments
  }

  /**
   * Commits an inventory: every counted product whose count differs from what the counter
   * saw is corrected — missing pieces are written off FIFO, extra pieces go back onto the
   * newest lot. Sales between counting and committing stay untouched.
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

    const allChanges: AppliedChange[] = []
    const count = await db.transaction(async (trx) => {
      const created = await InventoryCount.create(
        {
          actorId: actor.id,
          impersonatorId: options.impersonatorId ?? null,
          scope: input.scope,
          note: input.note?.trim() || null,
        },
        { client: trx }
      )

      // Products in id order, like every other lot lock — two counts cannot deadlock.
      for (const item of counted) {
        const difference = item.counted - item.expected
        let appliedQty = 0
        if (difference !== 0) {
          const lots = await this.lockLots(item.productId, trx)
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
            expectedQty: item.expected,
            countedQty: item.counted,
            appliedQty,
          },
          { client: trx }
        )
      }
      return created
    })

    const loss = allChanges.filter((c) => c.kind === 'loss')
    const surplus = allChanges.filter((c) => c.kind === 'surplus')
    await AuditService.log(actor.id, 'inventory.committed', 'inventory_count', count.id, null, {
      scope: input.scope,
      products: counted.length,
      lossQuantity: loss.reduce((sum, c) => sum + c.quantity, 0),
      surplusQuantity: surplus.reduce((sum, c) => sum + c.quantity, 0),
      lossValue: loss.reduce((sum, c) => sum + c.quantity * c.unitPrice, 0),
    })
    await this.auditPerSupplier(
      actor,
      'stock.adjusted',
      'inventory_count',
      count.id,
      allChanges.filter((c) => c.supplierId !== actor.id),
      { inventoryCountId: count.id }
    )
    return count
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
    return Delivery.query({ client: trx })
      .where('productId', productId)
      .whereNull('voidedAt')
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .forUpdate()
  }

  /** Takes `quantity` pieces off the oldest lots that still have some. */
  private async takeLoss(lots: Delivery[], quantity: number, trx: TransactionClientContract) {
    let remaining = quantity
    const touched: Array<{ lot: Delivery; kind: 'loss'; quantity: number }> = []
    for (const lot of lots) {
      if (remaining === 0) break
      const take = Math.min(lot.amountLeft, remaining)
      if (take <= 0) continue
      lot.amountLeft -= take
      lot.amountLost += take
      await lot.useTransaction(trx).save()
      touched.push({ lot, kind: 'loss', quantity: take })
      remaining -= take
    }
    return { lots: touched, changes: touched.map((t) => this.change(t)) }
  }

  /**
   * Puts found pieces back onto the newest lot of whoever counted — most likely theirs to
   * begin with — or, when they have none of this product, onto the newest lot there is.
   */
  private async addSurplus(
    lots: Delivery[],
    quantity: number,
    actorId: number,
    trx: TransactionClientContract
  ) {
    const lot = lots.findLast((l) => l.supplierId === actorId) ?? lots[lots.length - 1]
    if (!lot) return { lots: [], changes: [] }
    lot.amountLeft += quantity
    lot.amountLost -= quantity
    await lot.useTransaction(trx).save()
    const touched = [{ lot, kind: 'surplus' as const, quantity }]
    return { lots: touched, changes: touched.map((t) => this.change(t)) }
  }

  private change(t: { lot: Delivery; kind: 'loss' | 'surplus'; quantity: number }): AppliedChange {
    return {
      supplierId: t.lot.supplierId,
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
