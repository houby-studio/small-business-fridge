import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'

export default class CustomersController {
  /**
   * @show
   * @summary Get customer info
   * @description Returns customer profile information.
   * @tag Customers
   * @paramPath id - Customer user ID - @type(integer) @required
   * @responseBody 200 - {"data": {}}
   * @responseBody 401 - {"error": "Unauthorized"}
   */
  async show({ auth, params, response }: HttpContext) {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return response.badRequest({ error: 'Invalid customer id.' })
    }

    const actor = auth.user!
    if (actor.id !== id && actor.role !== 'admin') {
      return response.forbidden({ error: 'Forbidden' })
    }

    const customer = await User.query().where('id', id).select('id', 'displayName', 'role').first()
    if (!customer) {
      return response.notFound({ error: 'Customer not found.' })
    }

    return response.json({
      data: {
        id: customer.id,
        displayName: customer.displayName,
        role: customer.role,
      },
    })
  }

  /**
   * @insights
   * @summary Get customer purchase insights
   * @description Returns spending and invoice insight aggregates.
   * @tag Customers
   * @paramPath id - Customer user ID - @type(integer) @required
   * @responseBody 200 - {"data": {}}
   * @responseBody 401 - {"error": "Unauthorized"}
   */
  async insights({ auth, params, response }: HttpContext) {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return response.badRequest({ error: 'Invalid customer id.' })
    }

    const actor = auth.user!
    if (actor.id !== id && actor.role !== 'admin') {
      return response.forbidden({ error: 'Forbidden' })
    }

    const customer = await User.query().where('id', id).select('id').first()
    if (!customer) {
      return response.notFound({ error: 'Customer not found.' })
    }

    const orderStats = await db
      .from('orders')
      .join('deliveries', 'orders.delivery_id', 'deliveries.id')
      .where('orders.buyer_id', id)
      .select(
        db.rawQuery('COUNT(*)::int as order_count'),
        db.rawQuery('COALESCE(SUM(deliveries.price), 0)::numeric as total_spend'),
        db.rawQuery(
          'COALESCE(SUM(CASE WHEN orders.invoice_id IS NULL THEN deliveries.price ELSE 0 END), 0)::numeric as uninvoiced_spend'
        ),
        db.rawQuery('MAX(orders.created_at) as last_order_at')
      )
      .first()

    const invoiceStats = await db
      .from('invoices')
      .where('buyer_id', id)
      .select(
        db.rawQuery('COUNT(*)::int as invoice_count'),
        db.rawQuery(
          'COUNT(*) FILTER (WHERE is_paid = false AND is_payment_requested = false)::int as unpaid_invoice_count'
        ),
        db.rawQuery(
          'COUNT(*) FILTER (WHERE is_paid = false AND is_payment_requested = true)::int as pending_approval_invoice_count'
        )
      )
      .first()

    return response.json({
      data: {
        orderCount: Number(orderStats?.order_count ?? 0),
        totalSpend: Number(orderStats?.total_spend ?? 0),
        uninvoicedSpend: Number(orderStats?.uninvoiced_spend ?? 0),
        invoiceCount: Number(invoiceStats?.invoice_count ?? 0),
        unpaidInvoiceCount: Number(invoiceStats?.unpaid_invoice_count ?? 0),
        pendingApprovalInvoiceCount: Number(invoiceStats?.pending_approval_invoice_count ?? 0),
        lastOrderAt: orderStats?.last_order_at ?? null,
      },
    })
  }
}
