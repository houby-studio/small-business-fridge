import Invoice from '#models/invoice'
import { PUBLIC_USER_COLUMNS } from '#helpers/public_user'
import Order from '#models/order'
import User from '#models/user'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import AuditService from '#services/audit_service'
import NotificationService from '#services/notification_service'
import { runAfterResponse } from '#services/side_effects'
import { DomainError } from '#services/domain_error'

export type InvoiceErrorCode = 'TOTAL_CHANGED' | 'ISSUER_ACTIVE'

/** Who may settle a payment besides the issuer: an admin, for an issuer no longer around. */
export interface SettleOptions {
  /** The caller is an admin acting for a disabled supplier or one who is a customer now. */
  asAdmin?: boolean
}

/** The issuer left — disabled, or no longer a supplier — so nobody but an admin can settle. */
export function issuerIsGone(issuer: Pick<User, 'isDisabled' | 'role'>): boolean {
  return issuer.isDisabled || issuer.role === 'customer'
}

/**
 * The issuer settles their own invoices. An admin settles one only when its issuer is gone
 * (`issuerIsGone`); an active issuer's payments stay theirs to confirm.
 */
async function assertCanSettle(
  invoice: Invoice,
  actorId: number,
  options: SettleOptions
): Promise<void> {
  if (invoice.supplierId === actorId) return
  if (!options.asAdmin) throw new Error('FORBIDDEN')
  const issuer = await User.findOrFail(invoice.supplierId)
  if (!issuerIsGone(issuer)) throw new DomainError<InvoiceErrorCode>('ISSUER_ACTIVE')
}

/**
 * Guards a billing run the user approved from a preview: when purchases changed in between,
 * nothing is issued. `expected` is what others owe — the supplier's own purchases are left
 * out, as in the preview.
 */
function assertTotal(orders: Order[], expected: number | undefined, supplierId?: number): void {
  if (expected === undefined) return
  const total = orders
    .filter((order) => order.buyerId !== supplierId)
    .reduce((sum, order) => sum + order.unitPrice, 0)
  if (total !== expected) throw new DomainError<InvoiceErrorCode>('TOTAL_CHANGED')
}

/**
 * E-mails about invoices and payments go out here, not in the controllers, so the web and the
 * MCP tools tell people the same things. They are sent after the commit and never fail or
 * delay the call that triggered them.
 */
function notify(send: () => Promise<unknown>, what: string): void {
  runAfterResponse(send, `send ${what}`)
}

/**
 * The buyer of each new invoice gets it with the QR payment; a self-invoice (the supplier's
 * own purchases) is issued as paid and e-mails nobody. `actorId` set = issued by someone else
 * (an admin), whose suppliers learn about it.
 */
function notifyIssued(invoices: Invoice[], actorId?: number): void {
  const notifications = new NotificationService()
  for (const invoice of invoices) {
    if (invoice.buyerId === invoice.supplierId) continue
    notify(
      () => notifications.sendInvoiceNotice(invoice),
      `invoice notice for invoice #${invoice.id}`
    )
    if (actorId !== undefined) {
      notify(async () => {
        const actor = await User.find(actorId)
        if (actor) await notifications.sendInvoiceGeneratedToSupplier(invoice, actor)
      }, `supplier notice for invoice #${invoice.id}`)
    }
  }
}

export default class InvoiceService {
  /**
   * Generate invoices for all uninvoiced orders of a supplier, grouped by buyer.
   * Each buyer gets one invoice covering all their uninvoiced orders from this supplier.
   */
  async generateInvoices(
    supplierId: number,
    options: { expectedTotal?: number } = {}
  ): Promise<Invoice[]> {
    const issued = await db.transaction(async (trx) => {
      // Find all uninvoiced orders for this supplier's deliveries, grouped by buyer
      const groups = await Order.query({ client: trx })
        .whereNull('invoiceId')
        .whereHas('delivery', (q) => {
          q.where('supplierId', supplierId)
        })
        .preload('delivery')
        // Lock orders by id everywhere (corrections do too) so concurrent runs cannot
        // take the same rows in opposite orders and deadlock. Grouping by buyer is done below.
        .orderBy('id', 'asc')
        .forUpdate()

      if (groups.length === 0) {
        return []
      }
      assertTotal(groups, options.expectedTotal, supplierId)

      // Group orders by buyerId
      const byBuyer = new Map<number, typeof groups>()
      for (const order of groups) {
        const existing = byBuyer.get(order.buyerId) || []
        existing.push(order)
        byBuyer.set(order.buyerId, existing)
      }

      const invoices: Invoice[] = []

      for (const [buyerId, orders] of byBuyer) {
        const totalCost = orders.reduce((sum, o) => sum + o.unitPrice, 0)

        // Self-invoice (supplier buying from themselves) — auto-mark as paid
        const isSelfInvoice = buyerId === supplierId

        const invoice = await Invoice.create(
          {
            buyerId,
            supplierId,
            totalCost,
            isPaid: isSelfInvoice,
            isPaymentRequested: isSelfInvoice,
            paidAt: isSelfInvoice ? DateTime.now() : null,
            autoReminderCount: 0,
            manualReminderCount: 0,
          },
          { client: trx }
        )

        // Link all orders to this invoice
        const orderIds = orders.map((o) => o.id)
        await Order.query({ client: trx })
          .whereNull('invoiceId')
          .whereIn('id', orderIds)
          .update({ invoiceId: invoice.id })

        invoices.push(invoice)

        await AuditService.log(
          supplierId,
          'invoice.generated',
          'invoice',
          invoice.id,
          buyerId,
          { total: totalCost, orderCount: orders.length },
          { client: trx }
        )
      }

      return invoices
    })
    notifyIssued(issued)
    return issued
  }

  /**
   * Get uninvoiced orders summary for the supplier invoice dashboard.
   * Groups by buyer with order count and total cost.
   */
  async getUninvoicedSummary(supplierId: number) {
    const rows = await db
      .from('orders')
      .join('deliveries', 'orders.delivery_id', 'deliveries.id')
      .join('users', 'orders.buyer_id', 'users.id')
      .join('products', 'deliveries.product_id', 'products.id')
      .where('deliveries.supplier_id', supplierId)
      .whereNull('orders.invoice_id')
      .select(
        'users.id as buyer_id',
        'users.display_name as buyer_name',
        db.rawQuery('COUNT(*)::int as order_count'),
        db.rawQuery('COALESCE(SUM(orders.unit_price), 0)::numeric as total_cost')
      )
      .groupBy('users.id', 'users.display_name')
      .orderBy('total_cost', 'desc')

    return rows.map((r) => ({
      buyerId: r.buyer_id,
      buyerName: r.buyer_name,
      orderCount: r.order_count,
      totalCost: Number(r.total_cost),
    }))
  }

  /**
   * Get invoices for a specific buyer (customer view) with optional status filter.
   */
  async getInvoicesForBuyer(
    buyerId: number,
    page: number = 1,
    perPage: number = 20,
    filters?: { status?: string; sortBy?: string; sortOrder?: string }
  ) {
    const sortByWhitelist = ['createdAt', 'totalCost']
    const sortBy = sortByWhitelist.includes(filters?.sortBy ?? '') ? filters!.sortBy! : 'createdAt'
    const sortOrder = filters?.sortOrder === 'asc' ? 'asc' : 'desc'

    const query = Invoice.query()
      .where('buyerId', buyerId)
      // Buyers only ever see the supplier's name — never their email, IBAN or keypad ID.
      .preload('supplier', PUBLIC_USER_COLUMNS)
      .preload('orders', (q) => {
        q.preload('delivery', (dq) => dq.preload('product'))
      })
      .orderBy(sortBy, sortOrder)

    if (filters?.status === 'paid') {
      query.where('isPaid', true)
    } else if (filters?.status === 'unpaid') {
      query.where('isPaid', false).where('isPaymentRequested', false)
    } else if (filters?.status === 'awaiting') {
      query.where('isPaid', false).where('isPaymentRequested', true)
    }

    return query.paginate(page, perPage)
  }

  /**
   * Get invoices issued by a supplier (supplier payment view) with optional status, sort, and buyer filters.
   *
   * Rows are always grouped by what the supplier still has to do with them: payment requests
   * waiting for approval come first, then unpaid invoices, then paid ones. The caller-selected
   * sort (issue date, newest first, by default) only orders rows inside each group, and the
   * buyer's name breaks the remaining ties so one customer's invoices sit next to each other.
   */
  async getInvoicesForSupplier(
    supplierId: number,
    page: number = 1,
    perPage: number = 20,
    filters?: { status?: string; sortBy?: string; sortOrder?: string; buyerId?: number }
  ) {
    // Both tables carry `id` and `created_at`, so every ORDER BY column must be qualified.
    const sortByMap: Record<string, string> = {
      createdAt: 'invoices.created_at',
      totalCost: 'invoices.total_cost',
    }
    const sortColumn = sortByMap[filters?.sortBy ?? ''] ?? sortByMap.createdAt
    const sortOrder = filters?.sortOrder === 'asc' ? 'asc' : 'desc'

    const query = Invoice.query()
      // The join is only there for the buyer-name tiebreaker; `invoices.*` keeps the joined
      // `users.id` / `users.created_at` from overwriting the invoice's own columns.
      .join('users as buyers', 'buyers.id', 'invoices.buyer_id')
      .select('invoices.*')
      .where('supplierId', supplierId)
      // Suppliers only ever see the buyer's name — never their email, IBAN or keypad ID.
      .preload('buyer', PUBLIC_USER_COLUMNS)
      .preload('orders', (q) => {
        q.preload('delivery', (dq) => dq.preload('product'))
      })
      // Status rank: 0 = awaiting approval, 1 = unpaid, 2 = paid.
      .orderByRaw(
        'CASE WHEN invoices.is_paid THEN 2 WHEN invoices.is_payment_requested THEN 0 ELSE 1 END ASC'
      )
      .orderBy(sortColumn, sortOrder)
      .orderBy('buyers.display_name', 'asc')
      .orderBy('invoices.id', 'desc')

    if (filters?.status === 'paid') {
      query.where('isPaid', true)
    } else if (filters?.status === 'unpaid') {
      query.where('isPaid', false).where('isPaymentRequested', false)
    } else if (filters?.status === 'awaiting') {
      query.where('isPaid', false).where('isPaymentRequested', true)
    }

    if (filters?.buyerId) {
      query.where('buyerId', filters.buyerId)
    }

    return query.paginate(page, perPage)
  }

  /**
   * Customer marks invoice as paid (requests payment confirmation).
   */
  async requestPayment(invoiceId: number, buyerId: number): Promise<Invoice> {
    const { invoice, changed } = await this.changePayment(invoiceId, async (locked, trx) => {
      if (locked.buyerId !== buyerId) throw new Error('FORBIDDEN')
      if (locked.isPaid) throw new Error('ALREADY_PAID')
      // Reporting the same payment twice changes nothing and tells the supplier once.
      if (locked.isPaymentRequested) return false
      locked.isPaymentRequested = true
      await locked.useTransaction(trx).save()
      await AuditService.log(
        buyerId,
        'payment.requested',
        'invoice',
        invoiceId,
        locked.supplierId,
        { isPaymentRequested: { from: false, to: true } },
        { client: trx }
      )
      return true
    })
    if (changed) {
      notify(
        () => new NotificationService().sendPaymentRequestedNotification(invoice),
        `payment requested e-mail for invoice #${invoiceId}`
      )
    }
    return invoice
  }

  /**
   * Customer cancels their payment request.
   */
  async cancelPaymentRequest(invoiceId: number, buyerId: number): Promise<Invoice> {
    const { invoice, changed } = await this.changePayment(invoiceId, async (locked, trx) => {
      if (locked.buyerId !== buyerId) throw new Error('FORBIDDEN')
      if (locked.isPaid) throw new Error('ALREADY_PAID')
      if (!locked.isPaymentRequested) return false
      locked.isPaymentRequested = false
      await locked.useTransaction(trx).save()
      await AuditService.log(
        buyerId,
        'payment.request_cancelled',
        'invoice',
        invoiceId,
        locked.supplierId,
        { isPaymentRequested: { from: true, to: false } },
        { client: trx }
      )
      return true
    })
    if (changed) {
      notify(
        () => new NotificationService().sendPaymentWithdrawnNotification(invoice),
        `payment withdrawn e-mail for invoice #${invoiceId}`
      )
    }
    return invoice
  }

  /**
   * The issuer (or, with `asAdmin`, an admin for an issuer who left) confirms a payment.
   * `actorId` is who confirms. Confirming a paid invoice again changes nothing.
   */
  async approvePayment(
    invoiceId: number,
    actorId: number,
    options: SettleOptions = {}
  ): Promise<Invoice> {
    const { invoice, changed } = await this.changePayment(invoiceId, async (locked, trx) => {
      await assertCanSettle(locked, actorId, options)
      if (locked.isPaid) return false
      const wasPaymentRequested = locked.isPaymentRequested
      locked.isPaid = true
      locked.paidAt = DateTime.now()
      await locked.useTransaction(trx).save()
      await AuditService.log(
        actorId,
        'payment.approved',
        'invoice',
        invoiceId,
        locked.buyerId,
        {
          isPaid: { from: false, to: true },
          wasRequestedByCustomer: wasPaymentRequested,
          ...(actorId !== locked.supplierId && { onBehalfOf: locked.supplierId }),
        },
        { client: trx }
      )
      return true
    })
    if (changed) {
      notify(
        () => new NotificationService().sendPaymentStatusChange(invoice, 'approved'),
        `payment approved e-mail for invoice #${invoiceId}`
      )
    }
    return invoice
  }

  /**
   * The issuer (or an admin, see `approvePayment`) rejects a payment: the invoice is unpaid
   * and unreported again. Rejecting one that already is changes nothing.
   */
  async rejectPayment(
    invoiceId: number,
    actorId: number,
    options: SettleOptions = {}
  ): Promise<Invoice> {
    const { invoice, changed } = await this.changePayment(invoiceId, async (locked, trx) => {
      await assertCanSettle(locked, actorId, options)
      const wasPaid = locked.isPaid
      const wasPaymentRequested = locked.isPaymentRequested
      if (!wasPaid && !wasPaymentRequested) return false
      locked.isPaid = false
      locked.isPaymentRequested = false
      locked.paidAt = null
      await locked.useTransaction(trx).save()
      await AuditService.log(
        actorId,
        'payment.rejected',
        'invoice',
        invoiceId,
        locked.buyerId,
        {
          isPaid: { from: wasPaid, to: false },
          isPaymentRequested: { from: wasPaymentRequested, to: false },
          ...(actorId !== locked.supplierId && { onBehalfOf: locked.supplierId }),
        },
        { client: trx }
      )
      return true
    })
    if (changed) {
      notify(
        () => new NotificationService().sendPaymentStatusChange(invoice, 'rejected'),
        `payment rejected e-mail for invoice #${invoiceId}`
      )
    }
    return invoice
  }

  /**
   * Runs a payment state change on the invoice row locked for the transaction, so a double
   * click or the web and an assistant at once decide one after the other: the second sees
   * the first one's result. `change` returns whether it changed anything — e-mails go out
   * after the commit, and only then.
   */
  private async changePayment(
    invoiceId: number,
    change: (invoice: Invoice, trx: TransactionClientContract) => Promise<boolean>
  ): Promise<{ invoice: Invoice; changed: boolean }> {
    return db.transaction(async (trx) => {
      const invoice = await Invoice.query({ client: trx })
        .where('id', invoiceId)
        .forUpdate()
        .firstOrFail()
      const changed = await change(invoice, trx)
      return { invoice, changed }
    })
  }

  /**
   * Generate an invoice for a single buyer from a specific supplier.
   * Returns the Invoice or null if no uninvoiced orders exist for that pair.
   */
  async generateInvoiceForBuyer(
    supplierId: number,
    buyerId: number,
    options: { expectedTotal?: number } = {}
  ): Promise<Invoice | null> {
    const issued = await db.transaction(async (trx) => {
      const orders = await Order.query({ client: trx })
        .whereNull('invoiceId')
        .where('buyerId', buyerId)
        .whereHas('delivery', (q) => {
          q.where('supplierId', supplierId)
        })
        .preload('delivery')
        .orderBy('id', 'asc')
        .forUpdate()

      if (orders.length === 0) {
        return null
      }
      // One buyer: the expected total is all of theirs, even the supplier's own purchases.
      assertTotal(orders, options.expectedTotal)

      const totalCost = orders.reduce((sum, o) => sum + o.unitPrice, 0)
      const isSelfInvoice = buyerId === supplierId

      const invoice = await Invoice.create(
        {
          buyerId,
          supplierId,
          totalCost,
          isPaid: isSelfInvoice,
          isPaymentRequested: isSelfInvoice,
          paidAt: isSelfInvoice ? DateTime.now() : null,
          autoReminderCount: 0,
          manualReminderCount: 0,
        },
        { client: trx }
      )

      const orderIds = orders.map((o) => o.id)
      await Order.query({ client: trx })
        .whereNull('invoiceId')
        .whereIn('id', orderIds)
        .update({ invoiceId: invoice.id })

      await AuditService.log(
        supplierId,
        'invoice.generated',
        'invoice',
        invoice.id,
        buyerId,
        { total: totalCost, orderCount: orders.length },
        { client: trx }
      )

      return invoice
    })
    if (issued) notifyIssued([issued])
    return issued
  }

  /**
   * Admin-level: generate invoices for a single buyer across ALL suppliers.
   * Groups uninvoiced orders by supplierId and creates one invoice per group.
   */
  async generateInvoicesForUser(actorId: number, buyerId: number): Promise<Invoice[]> {
    const issued = await db.transaction(async (trx) => {
      const allOrders = await Order.query({ client: trx })
        .whereNull('invoiceId')
        .where('buyerId', buyerId)
        .preload('delivery')
        .orderBy('id', 'asc')
        .forUpdate()

      if (allOrders.length === 0) {
        return []
      }

      const bySupplier = new Map<number, typeof allOrders>()
      for (const order of allOrders) {
        const supplierId = order.delivery.supplierId
        const existing = bySupplier.get(supplierId) || []
        existing.push(order)
        bySupplier.set(supplierId, existing)
      }

      const invoices: Invoice[] = []

      for (const [supplierId, orders] of bySupplier) {
        const totalCost = orders.reduce((sum, o) => sum + o.unitPrice, 0)
        const isSelfInvoice = buyerId === supplierId

        const invoice = await Invoice.create(
          {
            buyerId,
            supplierId,
            totalCost,
            isPaid: isSelfInvoice,
            isPaymentRequested: isSelfInvoice,
            paidAt: isSelfInvoice ? DateTime.now() : null,
            autoReminderCount: 0,
            manualReminderCount: 0,
          },
          { client: trx }
        )

        const orderIds = orders.map((o) => o.id)
        await Order.query({ client: trx })
          .whereNull('invoiceId')
          .whereIn('id', orderIds)
          .update({ invoiceId: invoice.id })

        invoices.push(invoice)

        await AuditService.log(
          actorId,
          'invoice.generated',
          'invoice',
          invoice.id,
          buyerId,
          { total: totalCost, orderCount: orders.length, supplierId },
          { client: trx }
        )
      }

      return invoices
    })
    notifyIssued(issued, actorId)
    return issued
  }

  /**
   * Returns the subset of buyerIds that have at least one uninvoiced order.
   */
  async getUninvoicedBuyerIds(buyerIds: number[]): Promise<Set<number>> {
    if (buyerIds.length === 0) return new Set()

    const rows = await db
      .from('orders')
      .whereIn('buyer_id', buyerIds)
      .whereNull('invoice_id')
      .distinct('buyer_id')
      .select('buyer_id')

    return new Set(rows.map((r) => r.buyer_id))
  }

  /**
   * Returns the subset of buyerIds that have at least one unpaid invoice.
   */
  async getUnpaidBuyerIds(buyerIds: number[]): Promise<Set<number>> {
    if (buyerIds.length === 0) return new Set()

    const rows = await db
      .from('invoices')
      .whereIn('buyer_id', buyerIds)
      .where('is_paid', false)
      .distinct('buyer_id')
      .select('buyer_id')

    return new Set(rows.map((r) => r.buyer_id))
  }
}
