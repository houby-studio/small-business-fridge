import Invoice from '#models/invoice'
import Order from '#models/order'
import db from '@adonisjs/lucid/services/db'
import AuditService from '#services/audit_service'

export default class InvoiceService {
  /**
   * Generate invoices for all uninvoiced orders of a supplier, grouped by buyer.
   * Each buyer gets one invoice covering all their uninvoiced orders from this supplier.
   */
  async generateInvoices(supplierId: number): Promise<Invoice[]> {
    return db.transaction(async (trx) => {
      // Find all uninvoiced orders for this supplier's deliveries, grouped by buyer
      const groups = await Order.query({ client: trx })
        .whereNull('invoiceId')
        .whereHas('delivery', (q) => {
          q.where('supplierId', supplierId)
        })
        .preload('delivery')
        .orderBy('buyerId')

      if (groups.length === 0) {
        return []
      }

      // Group orders by buyerId
      const byBuyer = new Map<number, typeof groups>()
      for (const order of groups) {
        const existing = byBuyer.get(order.buyerId) || []
        existing.push(order)
        byBuyer.set(order.buyerId, existing)
      }

      const invoices: Invoice[] = []

      for (const [buyerId, orders] of byBuyer) {
        const totalCost = orders.reduce((sum, o) => sum + o.delivery.price, 0)

        // Self-invoice (supplier buying from themselves) — auto-mark as paid
        const isSelfInvoice = buyerId === supplierId

        const invoice = await Invoice.create(
          {
            buyerId,
            supplierId,
            totalCost,
            isPaid: isSelfInvoice,
            isPaymentRequested: isSelfInvoice,
            autoReminderCount: 0,
            manualReminderCount: 0,
          },
          { client: trx }
        )

        // Link all orders to this invoice
        await Order.query({ client: trx })
          .whereIn(
            'id',
            orders.map((o) => o.id)
          )
          .update({ invoiceId: invoice.id })

        invoices.push(invoice)

        AuditService.log(supplierId, 'invoice.generated', 'invoice', invoice.id, buyerId, {
          total: totalCost,
          orderCount: orders.length,
        })
      }

      return invoices
    })
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
        db.rawQuery('COALESCE(SUM(deliveries.price), 0)::numeric as total_cost')
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
    filters?: { status?: string }
  ) {
    const query = Invoice.query()
      .where('buyerId', buyerId)
      .preload('supplier')
      .preload('orders', (q) => {
        q.preload('delivery', (dq) => dq.preload('product'))
      })
      .orderBy('createdAt', 'desc')

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
   * Get invoices issued by a supplier (supplier payment view) with optional status filter.
   */
  async getInvoicesForSupplier(
    supplierId: number,
    page: number = 1,
    perPage: number = 20,
    filters?: { status?: string }
  ) {
    const query = Invoice.query()
      .where('supplierId', supplierId)
      .preload('buyer')
      .preload('orders', (q) => {
        q.preload('delivery', (dq) => dq.preload('product'))
      })
      .orderBy('createdAt', 'desc')

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
   * Customer marks invoice as paid (requests payment confirmation).
   */
  async requestPayment(invoiceId: number, buyerId: number): Promise<Invoice> {
    const invoice = await Invoice.findOrFail(invoiceId)

    if (invoice.buyerId !== buyerId) {
      throw new Error('FORBIDDEN')
    }
    if (invoice.isPaid) {
      throw new Error('ALREADY_PAID')
    }

    invoice.isPaymentRequested = true
    await invoice.save()

    AuditService.log(buyerId, 'payment.requested', 'invoice', invoiceId, invoice.supplierId)

    return invoice
  }

  /**
   * Customer cancels their payment request.
   */
  async cancelPaymentRequest(invoiceId: number, buyerId: number): Promise<Invoice> {
    const invoice = await Invoice.findOrFail(invoiceId)

    if (invoice.buyerId !== buyerId) {
      throw new Error('FORBIDDEN')
    }
    if (invoice.isPaid) {
      throw new Error('ALREADY_PAID')
    }

    invoice.isPaymentRequested = false
    await invoice.save()
    return invoice
  }

  /**
   * Supplier approves a payment.
   */
  async approvePayment(invoiceId: number, supplierId: number): Promise<Invoice> {
    const invoice = await Invoice.findOrFail(invoiceId)

    if (invoice.supplierId !== supplierId) {
      throw new Error('FORBIDDEN')
    }

    invoice.isPaid = true
    await invoice.save()

    AuditService.log(supplierId, 'payment.approved', 'invoice', invoiceId, invoice.buyerId)

    return invoice
  }

  /**
   * Supplier rejects a payment (marks as unpaid).
   */
  async rejectPayment(invoiceId: number, supplierId: number): Promise<Invoice> {
    const invoice = await Invoice.findOrFail(invoiceId)

    if (invoice.supplierId !== supplierId) {
      throw new Error('FORBIDDEN')
    }

    invoice.isPaid = false
    invoice.isPaymentRequested = false
    await invoice.save()

    AuditService.log(supplierId, 'payment.rejected', 'invoice', invoiceId, invoice.buyerId)

    return invoice
  }
}
