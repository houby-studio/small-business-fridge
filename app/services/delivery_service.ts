import { DateTime } from 'luxon'
import Delivery from '#models/delivery'
import DeliveryCorrection from '#models/delivery_correction'
import Product from '#models/product'
import type User from '#models/user'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import AuditService from '#services/audit_service'
import NotificationService from '#services/notification_service'
import { runAfterResponse } from '#services/side_effects'
import ProductService from '#services/product_service'
import { DomainError } from '#services/domain_error'
import { normalizeImagePath } from '#helpers/image_url'
import { roundMoney, suggestDraftPrice } from '#services/shopping/pricing'
import { DELIVERY_MAX_PRICE } from '#validators/delivery'

/** A repeated delivery of the same product by the same supplier within this window is flagged. */
export const DUPLICATE_WINDOW_MINUTES = 30
/**
 * A price is flagged when it is this many times higher or lower than the product's last
 * delivery AND differs by more than UNUSUAL_PRICE_MIN_DIFF — the ratio alone would fire on
 * every cheap item (2 → 3 Kč is already 1.5×).
 */
export const UNUSUAL_PRICE_RATIO = 1.5
export const UNUSUAL_PRICE_MIN_DIFF = 5
/** A product with this many pieces or fewer counts as low on stock. */
export const LOW_STOCK_THRESHOLD = 4

export type AddStockErrorCode = 'PRICE_REQUIRED'

export type RepriceErrorCode =
  | 'NOTHING_IN_STOCK'
  | 'NO_CHANGE'
  | 'DELIVERY_NOT_FOUND'
  | 'DELIVERY_VOIDED'
  | 'FORBIDDEN'
  | 'INVALID_PRICE'
  | 'DUPLICATE_LOT'

export type TransferErrorCode =
  | 'TRANSFER_SAME_USER'
  | 'TRANSFER_TARGET_INVALID'
  | 'NOTHING_TO_TRANSFER'

export type DeliveryCorrectionErrorCode =
  | 'DELIVERY_NOT_FOUND'
  | 'FORBIDDEN'
  | 'DELIVERY_VOIDED'
  | 'AMOUNT_BELOW_SOLD'
  | 'AMOUNT_INCREASE_NOT_ALLOWED'
  | 'NO_CHANGE'
  | 'DELIVERY_HAS_ORDERS'
  | 'DELIVERY_HAS_ADJUSTMENTS'
  | 'DELIVERY_TRANSFERRED'

/** Whose deliveries a listing covers: the whole fridge or only the viewer's own lots. */
export type StockScope = 'all' | 'mine'
export type StockState = 'all' | 'low' | 'out'

export interface StockWarnings {
  duplicate: { amount: number; price: number; minutesAgo: number } | null
  unusualPrice: {
    lastPrice: number
    lastSupplierId: number
    lastSupplierName: string
    lastCreatedAt: string
  } | null
  /**
   * The purchase price is far from the supplier's own last one — typically the price of a
   * whole pack typed in for a piece. Only the supplier's own lots: a colleague's purchase
   * price is theirs to know.
   */
  unusualPurchasePrice: { lastPurchasePrice: number; lastCreatedAt: string } | null
}

export interface StockRow {
  productId: number
  productName: string
  imagePath: string | null
  categoryName: string | null
  categoryColor: string | null
  totalSupplied: number
  totalRemaining: number
  /**
   * Pieces of the viewer's own lots — what "Změnit cenu" would reprice. Equals
   * `totalRemaining` for an admin (who reprices every lot) and in the `mine` scope.
   */
  myRemaining: number
  /** Pieces of the viewer's own lots only — an admin's too ("z toho moje"). */
  ownRemaining: number
  /** Pieces of the product in the whole fridge, whatever the scope ("v lednici celkem"). */
  totalRemainingAll: number
  /**
   * Selling price of the viewer's newest lot with pieces left (any lot for an admin) — what
   * "Změnit cenu" starts from. Null when the viewer has none of it in stock.
   */
  currentPrice: number | null
  totalSold: number
  deliveryCount: number
  totalStockValue: number
  /** Pieces sold in the last 30 days. */
  soldInPeriod: number
  /** Deliveries stocked in the last 30 days. */
  deliveredInPeriod: number
}

export interface StockInsights {
  lowStockCount: number
  outOfStockCount: number
  activeProducts: number
  period: '30d'
  categoryBreakdown: Array<{
    categoryName: string | null
    categoryColor: string | null
    totalRemaining: number
    productCount: number
  }>
  lowStockItems: StockRow[]
  topMovers: StockRow[]
}

export interface StockOverview {
  data: StockRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
  totals: { totalProducts: number; totalRemaining: number; totalStockValue: number }
  /**
   * Products with 1 to LOW_STOCK_THRESHOLD pieces — exactly what `stockState: 'low'` lists,
   * whatever filter is applied.
   */
  lowStockCount: number
  /** Sold-out products — exactly what `stockState: 'out'` lists. */
  outStockCount: number
  /** Only computed with `withInsights` (the MCP get_stock tool); the web does not need it. */
  insights?: StockInsights
}

export interface StockFilters {
  categoryId?: number
  sortBy?: string
  sortOrder?: string
  scope?: StockScope
  stockState?: StockState
  withInsights?: boolean
  /** The viewer is an admin: every lot counts as theirs in `myRemaining`. */
  viewerIsAdmin?: boolean
}

export interface DeliveryCorrectionResult {
  delivery: Delivery
  correction: DeliveryCorrection
  /** Orders whose price this correction changed — captured inside the transaction. */
  repricedOrderIds: number[]
}

type CorrectionActor = Pick<User, 'id' | 'role'>

export interface CorrectionOptions {
  /** The admin really acting, when they impersonate `actor` (set by the controller). */
  impersonatorId?: number
}

export interface CorrectionInput {
  amount: number
  price: number
  /** Omitted = unchanged, null = clear, number = the corrected purchase price. */
  purchasePrice?: number | null
  reason: string
}

export interface RepricedLot {
  deliveryId: number
  productId: number
  supplierId: number
  from: number
  to: number
  /** Pieces left on the lot — what the new price applies to. */
  pieces: number
}

export interface RepriceResult {
  /** Only the lots whose price really changed. */
  lots: RepricedLot[]
  pieces: number
}

/** A lot with pieces left, as the "Změnit cenu" and "Odepsat" dialogs list it (FIFO order). */
export interface LotInStock {
  deliveryId: number
  createdAt: string
  supplier: { id: number; name: string }
  amountLeft: number
  price: number
  /** The viewer's own lot. */
  mine: boolean
  /** The viewer may change its price: their own lot, or any lot for an admin. */
  editable: boolean
}

export interface TransferResult {
  lots: Array<{ fromDeliveryId: number; toDeliveryId: number; productId: number; pieces: number }>
  pieces: number
}

/** What still ties a supplier to the fridge — anything here blocks switching them off. */
export interface OpenBusiness {
  /** Their non-voided lots with pieces left. */
  lotsWithStock: number
  piecesLeft: number
  /** Purchases from their lots that are not invoiced yet. */
  uninvoicedOrders: number
}

const STOCK_SORT_COLUMNS: Record<string, string> = {
  productName: 'product_name',
  totalRemaining: 'total_remaining',
  totalSold: 'total_sold',
  soldInPeriod: 'sold_in_period',
  totalStockValue: 'total_stock_value',
  totalSupplied: 'total_supplied',
}

export default class DeliveryService {
  /**
   * Add stock for a product — create a new delivery record. `purchasePrice` is what the
   * supplier paid per piece, when they track it. Without a selling price it is derived from
   * the purchase price, `marginPercent` and the product's last price (`resolveSellingPrice`).
   * Pass `client` to stock inside a larger transaction (a bulk draft): the audit entry then
   * rolls back with it. `actorId` is who really stocked when it is not the supplier (an
   * admin committing their draft).
   */
  async addStock(
    supplierId: number,
    productId: number,
    amount: number,
    price: number | null,
    options: {
      purchasePrice?: number | null
      marginPercent?: number
      actorId?: number
      client?: TransactionClientContract
    } = {}
  ): Promise<Delivery> {
    const purchasePrice =
      options.purchasePrice === null || options.purchasePrice === undefined
        ? null
        : roundMoney(options.purchasePrice)
    const unitPrice = await this.resolveSellingPrice(
      productId,
      price,
      purchasePrice,
      options.marginPercent ?? 0,
      options.client
    )
    if (unitPrice === null) throw new DomainError<AddStockErrorCode>('PRICE_REQUIRED')

    // The lot, its audit entry and a lifted archive commit together — inside the caller's
    // transaction when there is one (a draft commit), otherwise in their own.
    const stock = async (trx: TransactionClientContract) => {
      const delivery = await Delivery.create(
        {
          supplierId,
          productId,
          amountSupplied: amount,
          amountLeft: amount,
          amountLost: 0,
          price: unitPrice,
          purchasePrice,
        },
        { client: trx }
      )

      const actorId = options.actorId ?? supplierId
      await AuditService.log(
        actorId,
        'delivery.created',
        'delivery',
        delivery.id,
        actorId !== supplierId ? supplierId : null,
        { productId, amount, price: unitPrice, ...(purchasePrice !== null && { purchasePrice }) },
        { client: trx }
      )

      // Stocking an archived product brings it back to the shop.
      await ProductService.unarchiveForStock(productId, actorId, trx)

      return delivery
    }

    return options.client ? stock(options.client) : db.transaction(stock)
  }

  /**
   * The selling price a new lot gets — the one rule for the web, drafts and MCP: a price
   * given by the supplier as is; otherwise the purchase price plus `marginPercent`, but
   * never below the product's current price (the newest lot of anyone), so restocking does
   * not quietly cut an established price. Null when there is neither price.
   */
  async resolveSellingPrice(
    productId: number,
    price: number | null,
    purchasePrice: number | null,
    marginPercent: number,
    client?: TransactionClientContract
  ): Promise<number | null> {
    if (price !== null) return price
    if (purchasePrice === null) return null
    const last = await Delivery.query({ client })
      .where('productId', productId)
      .whereNull('voidedAt')
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .select('price')
      .first()
    return suggestDraftPrice(roundMoney(purchasePrice), marginPercent, last?.price ?? null)
  }

  /**
   * Cheap sanity checks run before a delivery is created, so an accidental double submit
   * or a mistyped price is caught while it is still free to fix. `purchasePrice` is checked
   * against the supplier's own last purchase price. Returns null when there is nothing to
   * confirm. Pass `client` to read inside the caller's transaction.
   */
  async getStockWarnings(
    supplierId: number,
    productId: number,
    price: number,
    options: { purchasePrice?: number | null; client?: TransactionClientContract } = {}
  ): Promise<StockWarnings | null> {
    const since = DateTime.now().minus({ minutes: DUPLICATE_WINDOW_MINUTES })
    const purchasePrice = options.purchasePrice ?? null
    const lots = () =>
      Delivery.query({ client: options.client })
        .where('productId', productId)
        .whereNull('voidedAt')
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')

    // One after another: inside the caller's transaction they share one connection, and pg
    // refuses a query while the previous one is still running.
    const recentOwn = await lots()
      .where('supplierId', supplierId)
      .where('createdAt', '>=', since.toJSDate())
      .first()
    const lastDelivery = await lots().preload('supplier').first()
    const lastOwnPurchase =
      purchasePrice === null
        ? null
        : await lots().where('supplierId', supplierId).whereNotNull('purchasePrice').first()

    const duplicate = recentOwn
      ? {
          amount: recentOwn.amountSupplied,
          price: recentOwn.price,
          minutesAgo: Math.max(
            0,
            Math.floor(DateTime.now().diff(recentOwn.createdAt, 'minutes').minutes)
          ),
        }
      : null

    const unusualPrice =
      lastDelivery && DeliveryService.isUnusual(price, lastDelivery.price)
        ? {
            lastPrice: lastDelivery.price,
            lastSupplierId: lastDelivery.supplierId,
            lastSupplierName: lastDelivery.supplier?.displayName ?? '—',
            lastCreatedAt: lastDelivery.createdAt.toISO() ?? '',
          }
        : null

    const lastPurchasePrice = lastOwnPurchase?.purchasePrice ?? null
    const unusualPurchasePrice =
      purchasePrice !== null &&
      lastPurchasePrice !== null &&
      DeliveryService.isUnusual(purchasePrice, lastPurchasePrice)
        ? { lastPurchasePrice, lastCreatedAt: lastOwnPurchase!.createdAt.toISO() ?? '' }
        : null

    return duplicate || unusualPrice || unusualPurchasePrice
      ? { duplicate, unusualPrice, unusualPurchasePrice }
      : null
  }

  /** Far from the last value: UNUSUAL_PRICE_RATIO times off and more than MIN_DIFF apart. */
  private static isUnusual(value: number, last: number): boolean {
    return (
      Math.abs(value - last) > UNUSUAL_PRICE_MIN_DIFF &&
      (value >= last * UNUSUAL_PRICE_RATIO || value * UNUSUAL_PRICE_RATIO <= last)
    )
  }

  /**
   * Correct the amount, the selling price and/or the purchase price of a delivery after it
   * was stocked.
   *
   * - The amount can only go down, and never below what was already sold. Topping up an old
   *   delivery would let it jump the FIFO queue ahead of newer deliveries by other
   *   suppliers, so extra pieces always come in as a new delivery.
   * - A new selling price applies to the remaining stock and to every purchase from this
   *   delivery that is not invoiced yet. Invoiced purchases keep their price — an issued
   *   invoice never changes.
   * - The purchase price is the supplier's own cost; changing it never touches an order.
   *
   * The delivery row is locked first (as purchases do), then the uninvoiced orders (as
   * invoice generation does), so neither can interleave with the correction.
   */
  async correctDelivery(
    actor: CorrectionActor,
    deliveryId: number,
    input: CorrectionInput,
    options: CorrectionOptions = {}
  ): Promise<DeliveryCorrectionResult> {
    const result = await db.transaction(async (trx) => {
      const delivery = await this.lockForCorrection(actor, deliveryId, trx)

      const sold = delivery.amountSupplied - delivery.amountLeft
      if (input.amount > delivery.amountSupplied) {
        throw new DomainError<DeliveryCorrectionErrorCode>('AMOUNT_INCREASE_NOT_ALLOWED')
      }
      if (input.amount < sold) {
        throw new DomainError<DeliveryCorrectionErrorCode>('AMOUNT_BELOW_SOLD')
      }

      const priceChanged = input.price !== delivery.price
      const newPurchasePrice =
        input.purchasePrice === undefined
          ? delivery.purchasePrice
          : input.purchasePrice === null
            ? null
            : roundMoney(input.purchasePrice)
      const purchasePriceChanged = newPurchasePrice !== delivery.purchasePrice
      if (input.amount === delivery.amountSupplied && !priceChanged && !purchasePriceChanged) {
        throw new DomainError<DeliveryCorrectionErrorCode>('NO_CHANGE')
      }

      const correction = await DeliveryCorrection.create(
        {
          deliveryId: delivery.id,
          actorId: actor.id,
          impersonatorId: options.impersonatorId ?? null,
          kind: 'update',
          reason: input.reason,
          oldAmountSupplied: delivery.amountSupplied,
          newAmountSupplied: input.amount,
          oldPrice: delivery.price,
          newPrice: input.price,
          oldPurchasePrice: delivery.purchasePrice,
          newPurchasePrice,
          repricedOrderCount: 0,
        },
        { client: trx }
      )

      let repricedOrderIds: number[] = []
      if (priceChanged) {
        const uninvoiced = await trx
          .from('orders')
          .where('delivery_id', delivery.id)
          .whereNull('invoice_id')
          // Orders are always locked by id, as invoice generation does — any other order
          // could deadlock against it.
          .orderBy('id', 'asc')
          .forUpdate()
          .select('id')

        if (uninvoiced.length > 0) {
          const repriced = await trx
            .from('orders')
            .whereIn(
              'id',
              uninvoiced.map((row) => row.id)
            )
            .whereNull('invoice_id')
            .update({
              original_unit_price: trx.raw('COALESCE(original_unit_price, unit_price)'),
              unit_price: input.price,
              price_correction_id: correction.id,
              updated_at: new Date(),
            })
          repricedOrderIds = uninvoiced.map((row) => Number(row.id))
          correction.repricedOrderCount = Array.isArray(repriced)
            ? repriced.length
            : Number(repriced)
          await correction.save()
        }
      }

      delivery.amountSupplied = input.amount
      delivery.amountLeft = input.amount - sold
      delivery.price = input.price
      delivery.purchasePrice = newPurchasePrice
      await delivery.save()

      // Shrinkage is valued at the lot's purchase price, so a corrected typo must reach the
      // write-offs too. Their selling price stays: it is the price at the time of the loss.
      if (purchasePriceChanged) {
        await trx
          .from('stock_adjustments')
          .where('delivery_id', delivery.id)
          .update({ unit_cost: newPurchasePrice })
      }

      return { delivery, correction, repricedOrderIds }
    })

    const { delivery, correction } = result
    await AuditService.log(
      actor.id,
      'delivery.corrected',
      'delivery',
      delivery.id,
      delivery.supplierId === actor.id ? null : delivery.supplierId,
      {
        productId: delivery.productId,
        reason: correction.reason,
        // Only what actually changed — an unchanged "999 → 999" reads like a change.
        ...(correction.oldAmountSupplied !== correction.newAmountSupplied && {
          amountSupplied: { from: correction.oldAmountSupplied, to: correction.newAmountSupplied },
        }),
        ...(correction.oldPrice !== correction.newPrice && {
          price: { from: correction.oldPrice, to: correction.newPrice },
          repricedOrderCount: correction.repricedOrderCount,
        }),
        ...(correction.oldPurchasePrice !== correction.newPurchasePrice && {
          purchasePrice: { from: correction.oldPurchasePrice, to: correction.newPurchasePrice },
        }),
      }
    )

    this.notifyCorrection(result)
    return result
  }

  /**
   * Void a delivery nothing was sold from — typically a duplicate. The row is kept (with
   * both amounts zeroed and `voided_at` set) so the history and audit trail stay intact;
   * the original numbers live on the correction record. With `options.client` it runs
   * inside the caller's transaction and sends no e-mail — the caller calls
   * `notifyCorrection(result)` after its commit.
   */
  async voidDelivery(
    actor: CorrectionActor,
    deliveryId: number,
    reason: string,
    options: CorrectionOptions & { client?: TransactionClientContract } = {}
  ): Promise<DeliveryCorrectionResult> {
    const run = async (trx: TransactionClientContract): Promise<DeliveryCorrectionResult> => {
      const delivery = await this.lockForCorrection(actor, deliveryId, trx)

      const orderCount = await trx
        .from('orders')
        .where('delivery_id', delivery.id)
        .count('* as total')
        .first()
      if (Number(orderCount?.total ?? 0) > 0) {
        throw new DomainError<DeliveryCorrectionErrorCode>('DELIVERY_HAS_ORDERS')
      }
      // Nothing sold, but pieces were written off or found by an inventory — voiding would
      // erase them from the stock history.
      if (delivery.amountLost !== 0 || delivery.amountLeft !== delivery.amountSupplied) {
        throw new DomainError<DeliveryCorrectionErrorCode>('DELIVERY_HAS_ADJUSTMENTS')
      }
      // A handover moved real stock: voiding either side would make pieces vanish without
      // a write-off. A void is only for a lot entered by mistake.
      const handedOver =
        delivery.transferredFromId !== null ||
        (await trx.from('deliveries').where('transferred_from_id', delivery.id).first())
      if (handedOver) {
        throw new DomainError<DeliveryCorrectionErrorCode>('DELIVERY_TRANSFERRED')
      }

      const correction = await DeliveryCorrection.create(
        {
          deliveryId: delivery.id,
          actorId: actor.id,
          impersonatorId: options.impersonatorId ?? null,
          kind: 'void',
          reason,
          oldAmountSupplied: delivery.amountSupplied,
          newAmountSupplied: 0,
          oldPrice: delivery.price,
          newPrice: delivery.price,
          oldPurchasePrice: delivery.purchasePrice,
          newPurchasePrice: delivery.purchasePrice,
          repricedOrderCount: 0,
        },
        { client: trx }
      )

      delivery.amountSupplied = 0
      delivery.amountLeft = 0
      delivery.voidedAt = DateTime.now()
      await delivery.useTransaction(trx).save()

      await AuditService.log(
        actor.id,
        'delivery.voided',
        'delivery',
        delivery.id,
        delivery.supplierId === actor.id ? null : delivery.supplierId,
        {
          productId: delivery.productId,
          reason,
          amountSupplied: correction.oldAmountSupplied,
          price: correction.oldPrice,
        },
        { client: trx }
      )

      return { delivery, correction, repricedOrderIds: [] }
    }

    // Inside the caller's transaction (voiding a whole draft) the caller sends the e-mails
    // once everything committed — `notifyCorrection(result)`.
    if (options.client) return run(options.client)

    const result = await db.transaction(run)
    this.notifyCorrection(result)
    return result
  }

  /**
   * The e-mails a correction or a void sends, whatever channel made it (web, MCP): the
   * buyers whose uninvoiced purchases were repriced, and the supplier when someone else —
   * an admin, or an admin impersonating them — changed their lot. Sent after the response
   * (`runAfterResponse`): a mail failure never undoes the correction, and tests wait for them
   * with `settleSideEffects()`. `correctDelivery`/`voidDelivery` call it.
   */
  notifyCorrection(result: DeliveryCorrectionResult): void {
    const { delivery, correction, repricedOrderIds } = result
    const notifications = new NotificationService()
    if (correction.repricedOrderCount > 0) {
      runAfterResponse(
        () => notifications.sendPriceCorrectionNotifications(correction.id, repricedOrderIds),
        `price correction e-mails for correction #${correction.id}`
      )
    }
    if (correction.actorId !== delivery.supplierId || correction.impersonatorId) {
      runAfterResponse(
        () => notifications.sendDeliveryCorrectionToSupplier(correction.id),
        `supplier notice for correction #${correction.id}`
      )
    }
  }

  /**
   * The lots of a product with pieces left, in the order the fridge sells and writes them
   * off (`created_at`, then `id`). No purchase prices: a colleague's is theirs to know.
   */
  async listLotsInStock(
    viewer: Pick<User, 'id' | 'role'>,
    productId: number
  ): Promise<LotInStock[]> {
    const lots = await Delivery.query()
      .where('productId', productId)
      .whereNull('voidedAt')
      .where('amountLeft', '>', 0)
      .preload('supplier')
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
    return lots.map((lot) => ({
      deliveryId: lot.id,
      createdAt: lot.createdAt.toISO() ?? '',
      supplier: { id: lot.supplierId, name: lot.supplier?.displayName ?? '—' },
      amountLeft: lot.amountLeft,
      price: lot.price,
      mine: lot.supplierId === viewer.id,
      editable: lot.supplierId === viewer.id || viewer.role === 'admin',
    }))
  }

  /**
   * A new selling price for chosen lots that still have pieces — a sale or a price rise,
   * lot by lot. Never touches a purchase: what was sold keeps its price and no buyer is
   * e-mailed. A supplier changes only their own lots, an admin anyone's; the owner of a lot
   * an admin repriced gets an e-mail. One transaction for all lots, locked in FIFO order
   * (as purchases lock them). Each changed lot keeps a `reprice` record; the audit has one
   * entry per owner, product and new price.
   */
  async repriceLots(
    actor: CorrectionActor,
    items: Array<{ deliveryId: number; price: number }>,
    options: CorrectionOptions = {}
  ): Promise<RepriceResult> {
    if (items.length === 0) throw new DomainError<RepriceErrorCode>('NO_CHANGE')
    const wanted = new Map<number, number>()
    for (const item of items) {
      if (wanted.has(item.deliveryId)) throw new DomainError<RepriceErrorCode>('DUPLICATE_LOT')
      if (!Number.isInteger(item.price) || item.price < 1 || item.price > DELIVERY_MAX_PRICE) {
        throw new DomainError<RepriceErrorCode>('INVALID_PRICE')
      }
      wanted.set(item.deliveryId, item.price)
    }

    const result = await db.transaction(async (trx) => {
      const ids = [...wanted.keys()]
      const products = await trx.from('deliveries').whereIn('id', ids).select('id', 'product_id')
      if (products.length !== ids.length) {
        throw new DomainError<RepriceErrorCode>('DELIVERY_NOT_FOUND')
      }
      // Every lot of these products, product by product and oldest first — the order a
      // purchase (and a basket) locks them, so the two can never deadlock.
      const locked = await Delivery.query({ client: trx })
        .whereIn('productId', [...new Set(products.map((row) => Number(row.product_id)))])
        .orderBy('productId', 'asc')
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc')
        .forUpdate()
      const chosen = locked.filter((lot) => wanted.has(lot.id))
      for (const lot of chosen) {
        if (lot.voidedAt) throw new DomainError<RepriceErrorCode>('DELIVERY_VOIDED')
        if (lot.amountLeft <= 0) throw new DomainError<RepriceErrorCode>('NOTHING_IN_STOCK')
        if (actor.role !== 'admin' && lot.supplierId !== actor.id) {
          throw new DomainError<RepriceErrorCode>('FORBIDDEN')
        }
      }

      const changed = chosen.filter((lot) => lot.price !== wanted.get(lot.id))
      if (changed.length === 0) throw new DomainError<RepriceErrorCode>('NO_CHANGE')

      const repriced: RepricedLot[] = []
      const audit = new Map<
        string,
        {
          supplierId: number
          productId: number
          to: number
          from: Set<number>
          lots: number
          pieces: number
        }
      >()
      for (const lot of changed) {
        const to = wanted.get(lot.id)!
        await DeliveryCorrection.create(
          {
            deliveryId: lot.id,
            actorId: actor.id,
            impersonatorId: options.impersonatorId ?? null,
            kind: 'reprice',
            reason: '',
            oldAmountSupplied: lot.amountSupplied,
            newAmountSupplied: lot.amountSupplied,
            oldPrice: lot.price,
            newPrice: to,
            oldPurchasePrice: lot.purchasePrice,
            newPurchasePrice: lot.purchasePrice,
            repricedOrderCount: 0,
          },
          { client: trx }
        )
        repriced.push({
          deliveryId: lot.id,
          productId: lot.productId,
          supplierId: lot.supplierId,
          from: lot.price,
          to,
          pieces: lot.amountLeft,
        })
        const key = `${lot.supplierId}:${lot.productId}:${to}`
        const entry = audit.get(key) ?? {
          supplierId: lot.supplierId,
          productId: lot.productId,
          to,
          from: new Set<number>(),
          lots: 0,
          pieces: 0,
        }
        entry.from.add(lot.price)
        entry.lots += 1
        entry.pieces += lot.amountLeft
        audit.set(key, entry)

        lot.price = to
        await lot.useTransaction(trx).save()
      }

      for (const entry of audit.values()) {
        await AuditService.log(
          actor.id,
          'delivery.repriced',
          'product',
          entry.productId,
          entry.supplierId === actor.id ? null : entry.supplierId,
          {
            productId: entry.productId,
            // Lots of one product may have had different prices.
            from: [...entry.from].sort((a, b) => a - b),
            to: entry.to,
            lots: entry.lots,
            pieces: entry.pieces,
          },
          { client: trx }
        )
      }

      return { lots: repriced, pieces: repriced.reduce((sum, lot) => sum + lot.pieces, 0) }
    })

    // An admin changed a colleague's lots — the owner hears about it, once.
    const foreignOwners = new Set(
      result.lots.filter((lot) => lot.supplierId !== actor.id).map((lot) => lot.supplierId)
    )
    for (const ownerId of foreignOwners) {
      const lots = result.lots.filter((lot) => lot.supplierId === ownerId)
      runAfterResponse(
        () =>
          new NotificationService().sendRepriceToSupplier({
            supplierId: ownerId,
            actorId: options.impersonatorId ?? actor.id,
            lots,
          }),
        `reprice notice for supplier #${ownerId}`
      )
    }

    return result
  }

  /**
   * The shortcut "all my pieces of this product at one price" (MCP default): the actor's
   * own lots with pieces left — an admin's own too, never a colleague's — through
   * `repriceLots`.
   */
  async repriceRemaining(
    actor: CorrectionActor,
    productId: number,
    newPrice: number,
    options: CorrectionOptions = {}
  ): Promise<RepriceResult> {
    const own = await Delivery.query()
      .where('productId', productId)
      .where('supplierId', actor.id)
      .whereNull('voidedAt')
      .where('amountLeft', '>', 0)
      .select('id')
    if (own.length === 0) throw new DomainError<RepriceErrorCode>('NOTHING_IN_STOCK')
    return this.repriceLots(
      actor,
      own.map((lot) => ({ deliveryId: lot.id, price: newPrice })),
      options
    )
  }

  /**
   * Hand the stock of a leaving supplier over to a colleague (an admin action). Every
   * non-voided lot of `fromId` with pieces left is split: the original lot keeps what was
   * sold and written off — its sales, invoices and shrinkage stay with the original
   * supplier — and a new lot of `toId` gets the remaining pieces at the same selling and
   * purchase price. The new lot keeps the original `created_at`, so the FIFO order of the
   * fridge does not change, and points back at the original (`transferred_from_id`); both
   * get a `transfer` correction record. Pieces an inventory found (a negative
   * `amount_lost`) go with the stock they are part of.
   */
  async transferStock(
    fromId: number,
    toId: number,
    actor: Pick<User, 'id'>,
    options: CorrectionOptions = {}
  ): Promise<TransferResult> {
    if (fromId === toId) throw new DomainError<TransferErrorCode>('TRANSFER_SAME_USER')

    return db.transaction(async (trx) => {
      const target = await trx
        .from('users')
        .where('id', toId)
        .select('role', 'is_disabled')
        .forUpdate()
        .first()
      if (!target || target.is_disabled || !['supplier', 'admin'].includes(target.role)) {
        throw new DomainError<TransferErrorCode>('TRANSFER_TARGET_INVALID')
      }

      // Product by product, oldest first — the order a purchase locks the lots of a product.
      const lots = await Delivery.query({ client: trx })
        .where('supplierId', fromId)
        .whereNull('voidedAt')
        .where('amountLeft', '>', 0)
        .orderBy('productId', 'asc')
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc')
        .forUpdate()
      if (lots.length === 0) throw new DomainError<TransferErrorCode>('NOTHING_TO_TRANSFER')

      const moved: TransferResult['lots'] = []
      for (const lot of lots) {
        const pieces = lot.amountLeft
        const sold = lot.amountSupplied - lot.amountLeft - lot.amountLost
        const handedOver = await Delivery.create(
          {
            supplierId: toId,
            productId: lot.productId,
            amountSupplied: pieces,
            amountLeft: pieces,
            amountLost: 0,
            price: lot.price,
            purchasePrice: lot.purchasePrice,
            createdAt: lot.createdAt,
            transferredFromId: lot.id,
          },
          { client: trx }
        )
        const before = lot.amountSupplied
        // What stays: sold + written off. Found pieces left with the stock.
        lot.amountLost = Math.max(0, lot.amountLost)
        lot.amountSupplied = sold + lot.amountLost
        lot.amountLeft = 0
        await lot.useTransaction(trx).save()

        // Both lots remember when it happened (the new one keeps the old date for FIFO).
        for (const [deliveryId, from, to] of [
          [lot.id, before, lot.amountSupplied],
          [handedOver.id, 0, pieces],
        ]) {
          await DeliveryCorrection.create(
            {
              deliveryId,
              actorId: actor.id,
              impersonatorId: options.impersonatorId ?? null,
              kind: 'transfer',
              reason: '',
              oldAmountSupplied: from,
              newAmountSupplied: to,
              oldPrice: lot.price,
              newPrice: lot.price,
              oldPurchasePrice: lot.purchasePrice,
              newPurchasePrice: lot.purchasePrice,
              repricedOrderCount: 0,
            },
            { client: trx }
          )
        }
        moved.push({
          fromDeliveryId: lot.id,
          toDeliveryId: handedOver.id,
          productId: lot.productId,
          pieces,
        })
      }

      const pieces = moved.reduce((sum, lot) => sum + lot.pieces, 0)
      const metadata = {
        fromUserId: fromId,
        toUserId: toId,
        pieces,
        lots: moved,
        ...(options.impersonatorId && { impersonatorId: options.impersonatorId }),
      }
      // One entry for each side, so both see it in their own audit log.
      for (const affected of [fromId, toId]) {
        await AuditService.log(
          actor.id,
          'delivery.transferred',
          'user',
          fromId,
          affected === actor.id ? null : affected,
          metadata,
          { client: trx }
        )
      }

      return { lots: moved, pieces }
    })
  }

  /**
   * Put `quantity` pieces back on stock that were sold from or written off `lotId` — a
   * storno or a reverted write-off. The caller has already taken them off the lot's sold or
   * lost side (deleted the order, lowered `amount_lost`). Normally they simply go back to
   * the lot. When the lot's stock was handed over to a colleague (`transferStock`), they go
   * to the lot that took it over — followed through every later handover — because the
   * leaving supplier no longer sells anything: the original lot gives the pieces up
   * (`amount_supplied -= quantity`) and the heir's lot receives them. Every lot on the way
   * is locked, original first (the order a purchase locks them). Returns the lot that got
   * the pieces.
   */
  async returnPieces(
    lotId: number,
    quantity: number,
    trx: TransactionClientContract
  ): Promise<Delivery> {
    const original = await Delivery.query({ client: trx })
      .where('id', lotId)
      .forUpdate()
      .firstOrFail()
    const target = await this.returnTargetLot(original.id, trx)
    if (target.id === original.id) {
      original.amountLeft += quantity
      await original.useTransaction(trx).save()
      return original
    }
    original.amountSupplied -= quantity
    await original.useTransaction(trx).save()
    target.amountSupplied += quantity
    target.amountLeft += quantity
    await target.useTransaction(trx).save()
    return target
  }

  /**
   * The lot that holds the stock of `lotId` now: the lot itself, or — after a handover —
   * the heir's lot split off it, followed through later handovers. Each lot is locked.
   */
  async returnTargetLot(lotId: number, trx: TransactionClientContract): Promise<Delivery> {
    let current = await Delivery.query({ client: trx }).where('id', lotId).forUpdate().firstOrFail()
    for (;;) {
      const next = await Delivery.query({ client: trx })
        .where('transferredFromId', current.id)
        .whereNull('voidedAt')
        .orderBy('id', 'desc')
        .forUpdate()
        .first()
      if (!next) return current
      current = next
    }
  }

  /** What would block switching `userId` off as a supplier (see `OpenBusiness`). */
  async openBusinessOf(userId: number): Promise<OpenBusiness> {
    const stock = await db
      .from('deliveries')
      .where('supplier_id', userId)
      .whereNull('voided_at')
      .where('amount_left', '>', 0)
      .select(
        db.raw('COUNT(*)::int AS lots'),
        db.raw('COALESCE(SUM(amount_left), 0)::int AS pieces')
      )
      .first()
    const orders = await db
      .from('orders')
      .join('deliveries', 'deliveries.id', 'orders.delivery_id')
      .where('deliveries.supplier_id', userId)
      .whereNull('orders.invoice_id')
      .count('* as total')
      .first()
    return {
      lotsWithStock: Number(stock?.lots ?? 0),
      piecesLeft: Number(stock?.pieces ?? 0),
      uninvoicedOrders: Number(orders?.total ?? 0),
    }
  }

  private async lockForCorrection(
    actor: CorrectionActor,
    deliveryId: number,
    trx: TransactionClientContract
  ): Promise<Delivery> {
    const delivery = await Delivery.query({ client: trx })
      .where('id', deliveryId)
      .forUpdate()
      .first()

    if (!delivery) {
      throw new DomainError<DeliveryCorrectionErrorCode>('DELIVERY_NOT_FOUND')
    }
    if (actor.role !== 'admin' && delivery.supplierId !== actor.id) {
      throw new DomainError<DeliveryCorrectionErrorCode>('FORBIDDEN')
    }
    if (delivery.voidedAt) {
      throw new DomainError<DeliveryCorrectionErrorCode>('DELIVERY_VOIDED')
    }

    return delivery
  }

  /**
   * Stock overview grouped by product: supplied / remaining / sold, stock value and the
   * last 30 days of activity. `scope` narrows it to the viewer's own lots, `stockState` to
   * products running low or sold out. Sorted, filtered and paginated in SQL; the totals and
   * the low-stock count always cover every product of the scope and category.
   */
  async getStockForSupplier(
    supplierId: number,
    page: number = 1,
    perPage: number = 20,
    filters: StockFilters = {}
  ): Promise<StockOverview> {
    const scope: StockScope = filters.scope === 'mine' ? 'mine' : 'all'
    const stockState: StockState =
      filters.stockState === 'low' || filters.stockState === 'out' ? filters.stockState : 'all'
    const sortColumn = STOCK_SORT_COLUMNS[filters.sortBy ?? ''] ?? 'product_name'
    const sortDir: 'asc' | 'desc' = filters.sortOrder === 'desc' ? 'desc' : 'asc'
    const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const bindings: Record<string, unknown> = {
      supplierId,
      categoryId: filters.categoryId ?? null,
      periodStart,
      lowThreshold: LOW_STOCK_THRESHOLD,
      allMine: filters.viewerIsAdmin === true,
    }
    const mine = scope === 'mine'
    const ownOnly = (column: string) => (mine ? `AND ${column} = :supplierId` : '')
    const byCategory = filters.categoryId ? 'AND p.category_id = :categoryId' : ''

    // Every product of the scope with its lots summed up; the 30-day activity comes from two
    // small grouped subqueries joined in, so a page can be sorted by it in SQL.
    const grouped = `
      WITH sold AS (
        SELECT d.product_id, COUNT(*)::int AS sold_in_period
          FROM orders o
          JOIN deliveries d ON d.id = o.delivery_id
         WHERE o.created_at >= :periodStart ${ownOnly('d.supplier_id')}
         GROUP BY d.product_id
      ), delivered AS (
        SELECT product_id, COUNT(*)::int AS delivered_in_period
          FROM deliveries
         WHERE voided_at IS NULL AND created_at >= :periodStart ${ownOnly('supplier_id')}
         GROUP BY product_id
      ), fridge AS (
        SELECT product_id, SUM(amount_left)::int AS remaining_all
          FROM deliveries
         WHERE voided_at IS NULL
         GROUP BY product_id
      ), grouped AS (
        SELECT p.id AS product_id,
               p.display_name AS product_name,
               p.image_path,
               c.name AS category_name,
               c.color AS category_color,
               SUM(d.amount_supplied)::int AS total_supplied,
               SUM(d.amount_left)::int AS total_remaining,
               COALESCE(SUM(d.amount_left) FILTER (
                 WHERE :allMine OR d.supplier_id = :supplierId
               ), 0)::int AS my_remaining,
               COALESCE(SUM(d.amount_left) FILTER (WHERE d.supplier_id = :supplierId), 0)::int
                 AS own_remaining,
               COALESCE(f.remaining_all, 0)::int AS total_remaining_all,
               (ARRAY_AGG(d.price ORDER BY d.created_at DESC, d.id DESC) FILTER (
                 WHERE d.amount_left > 0 AND (:allMine OR d.supplier_id = :supplierId)
               ))[1]::int AS current_price,
               SUM(d.amount_supplied - d.amount_left - d.amount_lost)::int AS total_sold,
               COUNT(d.id)::int AS delivery_count,
               SUM(d.price * d.amount_left)::numeric AS total_stock_value,
               COALESCE(s.sold_in_period, 0)::int AS sold_in_period,
               COALESCE(dl.delivered_in_period, 0)::int AS delivered_in_period
          FROM deliveries d
          JOIN products p ON p.id = d.product_id
          LEFT JOIN categories c ON c.id = p.category_id
          LEFT JOIN sold s ON s.product_id = p.id
          LEFT JOIN delivered dl ON dl.product_id = p.id
          LEFT JOIN fridge f ON f.product_id = p.id
         WHERE d.voided_at IS NULL ${ownOnly('d.supplier_id')} ${byCategory}
         GROUP BY p.id, p.display_name, p.image_path, c.name, c.color,
                  s.sold_in_period, dl.delivered_in_period, f.remaining_all
      )`
    const stateWhere =
      stockState === 'out'
        ? 'WHERE total_remaining = 0'
        : stockState === 'low'
          ? 'WHERE total_remaining BETWEEN 1 AND :lowThreshold'
          : ''

    type Rows<T> = { rows: T[] }
    const [pageRows, summary] = await Promise.all([
      db.rawQuery<Rows<Record<string, any>>>(
        `${grouped}
         SELECT * FROM grouped ${stateWhere}
          ORDER BY ${sortColumn} ${sortDir}, product_name ASC, product_id ASC
          LIMIT :limit OFFSET :offset`,
        { ...bindings, limit: perPage, offset: (page - 1) * perPage }
      ),
      db.rawQuery<Rows<Record<string, any>>>(
        `${grouped}
         SELECT COUNT(*)::int AS total_products,
                COALESCE(SUM(total_remaining), 0)::int AS total_remaining,
                COALESCE(SUM(total_stock_value), 0)::numeric AS total_stock_value,
                COUNT(*) FILTER (WHERE total_remaining = 0)::int AS out_count,
                COUNT(*) FILTER (WHERE total_remaining BETWEEN 1 AND :lowThreshold)::int AS low_count
           FROM grouped`,
        bindings
      ),
    ])

    const sums = summary.rows[0] ?? {}
    const totalProducts = Number(sums.total_products ?? 0)
    const outCount = Number(sums.out_count ?? 0)
    const lowCount = Number(sums.low_count ?? 0)
    const total = stockState === 'out' ? outCount : stockState === 'low' ? lowCount : totalProducts

    const overview: StockOverview = {
      data: pageRows.rows.map(DeliveryService.mapStockRow),
      meta: {
        total,
        perPage,
        currentPage: page,
        lastPage: Math.max(1, Math.ceil(total / perPage)),
      },
      totals: {
        totalProducts,
        totalRemaining: Number(sums.total_remaining ?? 0),
        totalStockValue: Number(sums.total_stock_value ?? 0),
      },
      lowStockCount: lowCount,
      outStockCount: outCount,
    }

    if (filters.withInsights) {
      const all = await db.rawQuery<Rows<Record<string, any>>>(
        `${grouped} SELECT * FROM grouped ORDER BY product_name ASC`,
        bindings
      )
      overview.insights = DeliveryService.buildInsights(all.rows.map(DeliveryService.mapStockRow))
    }

    return overview
  }

  private static mapStockRow(r: Record<string, any>): StockRow {
    return {
      productId: Number(r.product_id),
      productName: r.product_name,
      imagePath: normalizeImagePath(r.image_path),
      categoryName: r.category_name ?? null,
      categoryColor: r.category_color ?? null,
      totalSupplied: Number(r.total_supplied),
      totalRemaining: Number(r.total_remaining),
      myRemaining: Number(r.my_remaining),
      ownRemaining: Number(r.own_remaining),
      totalRemainingAll: Number(r.total_remaining_all),
      currentPrice: r.current_price === null ? null : Number(r.current_price),
      totalSold: Number(r.total_sold),
      deliveryCount: Number(r.delivery_count),
      totalStockValue: Number(r.total_stock_value),
      soldInPeriod: Number(r.sold_in_period),
      deliveredInPeriod: Number(r.delivered_in_period),
    }
  }

  private static buildInsights(rows: StockRow[]): StockInsights {
    const lowStockItems = rows
      .filter(
        (r) =>
          r.totalRemaining > 0 &&
          r.totalRemaining <= LOW_STOCK_THRESHOLD &&
          (r.soldInPeriod > 0 || r.deliveredInPeriod > 0)
      )
      .sort((a, b) => {
        if (a.totalRemaining !== b.totalRemaining) return a.totalRemaining - b.totalRemaining
        return b.soldInPeriod - a.soldInPeriod
      })
      .slice(0, 12)

    const topMovers = rows
      .filter((r) => r.soldInPeriod > 0)
      .sort((a, b) => b.soldInPeriod - a.soldInPeriod)
      .slice(0, 8)

    const categoryMap = new Map<string, StockInsights['categoryBreakdown'][number]>()
    for (const row of rows) {
      const key = row.categoryName ?? '__uncategorized__'
      const current = categoryMap.get(key) ?? {
        categoryName: row.categoryName ?? null,
        categoryColor: row.categoryColor,
        totalRemaining: 0,
        productCount: 0,
      }
      current.totalRemaining += row.totalRemaining
      if (row.totalRemaining > 0) current.productCount += 1
      categoryMap.set(key, current)
    }

    return {
      lowStockCount: lowStockItems.length,
      outOfStockCount: rows.filter((r) => r.totalRemaining === 0).length,
      activeProducts: rows.filter((r) => r.totalRemaining > 0).length,
      period: '30d',
      categoryBreakdown: [...categoryMap.values()].sort(
        (a, b) => b.totalRemaining - a.totalRemaining
      ),
      lowStockItems,
      topMovers,
    }
  }

  /**
   * Get recent deliveries for a supplier (or the whole fridge) with optional product filter
   * and sort. Corrections are preloaded newest first so the history can show them.
   */
  async getRecentDeliveries(
    supplierId: number,
    page: number = 1,
    perPage: number = 20,
    filters?: {
      productId?: number
      sortBy?: string
      sortOrder?: string
      scope?: StockScope
    }
  ) {
    const SORT_WHITELIST = ['createdAt', 'price']
    const safeSort = SORT_WHITELIST.includes(filters?.sortBy ?? '') ? filters!.sortBy! : 'createdAt'
    const sortDir: 'asc' | 'desc' = filters?.sortOrder === 'asc' ? 'asc' : 'desc'

    const query = Delivery.query()
      .preload('product', (q) => q.preload('category'))
      .preload('supplier')
      .preload('corrections', (q) => q.orderBy('createdAt', 'desc').orderBy('id', 'desc'))
      .preload('transferredFrom', (q) => q.preload('supplier'))
      .preload('transferredTo', (q) =>
        q
          .preload('supplier')
          .preload('corrections', (c) => c.where('kind', 'transfer'))
          .orderBy('id', 'asc')
      )
      .orderBy(safeSort, sortDir)
      .orderBy('id', sortDir)

    if (filters?.scope !== 'all') {
      query.where('supplierId', supplierId)
    }

    if (filters?.productId) {
      query.where('productId', filters.productId)
    }

    return query.paginate(page, perPage)
  }

  /**
   * Per-delivery purchase counts the correction dialog needs to show its impact preview:
   * how many units are invoiced (their price is final) and how many purchases, by how many
   * buyers, a price correction would still reach.
   */
  async getOrderStatsForDeliveries(deliveryIds: number[]) {
    const stats = new Map<
      number,
      { invoicedCount: number; uninvoicedCount: number; uninvoicedBuyerCount: number }
    >()
    if (deliveryIds.length === 0) return stats

    const rows = await db
      .from('orders')
      .whereIn('delivery_id', deliveryIds)
      .groupBy('delivery_id')
      .select('delivery_id')
      .select(db.rawQuery('COUNT(*) FILTER (WHERE invoice_id IS NOT NULL)::int as invoiced'))
      .select(db.rawQuery('COUNT(*) FILTER (WHERE invoice_id IS NULL)::int as uninvoiced'))
      .select(
        db.rawQuery(
          'COUNT(DISTINCT buyer_id) FILTER (WHERE invoice_id IS NULL)::int as uninvoiced_buyers'
        )
      )

    for (const row of rows) {
      stats.set(Number(row.delivery_id), {
        invoicedCount: Number(row.invoiced),
        uninvoicedCount: Number(row.uninvoiced),
        uninvoicedBuyerCount: Number(row.uninvoiced_buyers),
      })
    }
    return stats
  }

  /**
   * Get all products (for the delivery history filter).
   */
  async getAllProducts() {
    return Product.query().preload('category').orderBy('displayName', 'asc')
  }

  /**
   * Selling and purchase price of every product's newest lot (or only of `productIds`) —
   * the stocking form shows them as a reminder and suggests them for the next lot. The
   * selling price is public, so it comes from anyone's lot. A purchase price is a
   * supplier's own cost: with `purchasePriceOf` it comes only from that supplier's newest
   * lot that has one (null when there is none); without it, from the newest lot of anyone.
   */
  async getLastPrices(
    productIds?: number[],
    options: { purchasePriceOf?: number } = {}
  ): Promise<Map<number, { price: number; purchasePrice: number | null }>> {
    if (productIds && productIds.length === 0) return new Map()
    const own = options.purchasePriceOf !== undefined
    const result = await db.rawQuery<{
      rows: Array<{ product_id: number; price: number; purchase_price: string | null }>
    }>(
      `SELECT DISTINCT ON (d.product_id) d.product_id, d.price,
              ${own ? 'mine.purchase_price' : 'd.purchase_price'} AS purchase_price
         FROM deliveries d
         ${
           own
             ? `LEFT JOIN LATERAL (
                  SELECT o.purchase_price FROM deliveries o
                   WHERE o.product_id = d.product_id AND o.supplier_id = :supplierId
                     AND o.voided_at IS NULL AND o.purchase_price IS NOT NULL
                   ORDER BY o.created_at DESC, o.id DESC LIMIT 1
                ) mine ON TRUE`
             : ''
         }
        WHERE d.voided_at IS NULL
          ${productIds ? 'AND d.product_id = ANY(:productIds)' : ''}
        ORDER BY d.product_id, d.created_at DESC, d.id DESC`,
      { ...(productIds && { productIds }), ...(own && { supplierId: options.purchasePriceOf }) }
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
   * Whether `viewer` may see the purchase price of a lot: their own lots, or every lot for
   * an admin. A colleague's purchase price is their private cost.
   */
  static canSeePurchasePrice(viewer: Pick<User, 'id' | 'role'>, lotSupplierId: number): boolean {
    return viewer.role === 'admin' || viewer.id === lotSupplierId
  }
}
