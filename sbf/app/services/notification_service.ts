import mail from '@adonisjs/mail/services/main'
import i18nManager from '@adonisjs/i18n/services/main'
import env from '#start/env'
import User from '#models/user'
import Order from '#models/order'
import Invoice from '#models/invoice'
import db from '@adonisjs/lucid/services/db'

export default class NotificationService {
  private get i18n() {
    return i18nManager.locale(i18nManager.defaultLocale)
  }

  /**
   * Send purchase confirmation email to the buyer.
   */
  async sendPurchaseConfirmation(order: Order) {
    await order.load('buyer')
    await order.load('delivery', (q) => {
      q.preload('product')
      q.preload('supplier')
    })

    const buyer = order.buyer
    if (!buyer.sendMailOnPurchase) return

    const productId = order.delivery.product.id
    const isFavorite = await db
      .from('user_favorites')
      .where('user_id', buyer.id)
      .where('product_id', productId)
      .first()

    const appUrl = env.get('APP_URL') || `http://${env.get('HOST')}:${env.get('PORT')}`
    const addFavoriteUrl = isFavorite ? null : `${appUrl}/shop?add_favorite=${productId}`

    await mail.send((message) => {
      message
        .to(buyer.email)
        .subject(
          this.i18n.t('emails.purchase_subject', { product: order.delivery.product.displayName })
        )
        .htmlView('emails/purchase_confirmation', {
          i18n: this.i18n,
          buyerName: buyer.displayName,
          productName: order.delivery.product.displayName,
          price: order.delivery.price,
          supplierName: order.delivery.supplier.displayName,
          date: order.createdAt.toFormat('dd.MM.yyyy HH:mm'),
          addFavoriteUrl,
        })
    })
  }

  /**
   * Send invoice notification to the buyer.
   */
  async sendInvoiceNotice(invoice: Invoice) {
    await invoice.load('buyer')
    await invoice.load('supplier')
    await invoice.load('orders', (q) => {
      q.preload('delivery', (dq) => dq.preload('product'))
    })

    const buyer = invoice.buyer

    await mail.send((message) => {
      message
        .to(buyer.email)
        .subject(
          this.i18n.t('emails.invoice_subject', { id: invoice.id, amount: invoice.totalCost })
        )
        .htmlView('emails/invoice_notice', {
          i18n: this.i18n,
          buyerName: buyer.displayName,
          supplierName: invoice.supplier.displayName,
          invoiceId: invoice.id,
          totalCost: invoice.totalCost,
          orders: invoice.orders.map((o) => ({
            productName: o.delivery.product.displayName,
            price: o.delivery.price,
            date: o.createdAt.toFormat('dd.MM.yyyy'),
          })),
          supplierIban: invoice.supplier.iban,
        })
    })
  }

  /**
   * Send payment status change to the buyer.
   */
  async sendPaymentStatusChange(invoice: Invoice, action: 'approved' | 'rejected') {
    await invoice.load('buyer')
    await invoice.load('supplier')

    const buyer = invoice.buyer
    const subjectKey =
      action === 'approved' ? 'emails.payment_approved_subject' : 'emails.payment_rejected_subject'

    await mail.send((message) => {
      message
        .to(buyer.email)
        .subject(this.i18n.t(subjectKey, { id: invoice.id }))
        .htmlView('emails/payment_status', {
          i18n: this.i18n,
          buyerName: buyer.displayName,
          supplierName: invoice.supplier.displayName,
          invoiceId: invoice.id,
          totalCost: invoice.totalCost,
          action,
        })
    })
  }

  /**
   * Send daily purchase report to each user who opted in.
   */
  async sendDailyPurchaseReports() {
    const users = await User.query().where('sendDailyReport', true).where('isDisabled', false)

    for (const user of users) {
      const todayOrders = await Order.query()
        .where('buyerId', user.id)
        .whereRaw('created_at >= CURRENT_DATE')
        .preload('delivery', (q) => q.preload('product'))
        .orderBy('createdAt', 'desc')

      if (todayOrders.length === 0) continue

      const totalSpent = todayOrders.reduce((sum, o) => sum + o.delivery.price, 0)

      await mail.send((message) => {
        message
          .to(user.email)
          .subject(
            this.i18n.t('emails.daily_report_subject', {
              count: todayOrders.length,
              total: totalSpent,
            })
          )
          .htmlView('emails/daily_report', {
            i18n: this.i18n,
            userName: user.displayName,
            orders: todayOrders.map((o) => ({
              productName: o.delivery.product.displayName,
              price: o.delivery.price,
              time: o.createdAt.toFormat('HH:mm'),
            })),
            totalSpent,
            orderCount: todayOrders.length,
          })
      })
    }
  }

  /**
   * Send unpaid invoice reminders to buyers.
   */
  async sendUnpaidInvoiceReminders() {
    const unpaidInvoices = await Invoice.query()
      .where('isPaid', false)
      .where('isPaymentRequested', false)
      .preload('buyer')
      .preload('supplier')

    for (const invoice of unpaidInvoices) {
      const buyer = invoice.buyer
      if (buyer.isDisabled) continue

      await mail.send((message) => {
        message
          .to(buyer.email)
          .subject(
            this.i18n.t('emails.unpaid_reminder_subject', {
              id: invoice.id,
              amount: invoice.totalCost,
            })
          )
          .htmlView('emails/unpaid_reminder', {
            i18n: this.i18n,
            buyerName: buyer.displayName,
            supplierName: invoice.supplier.displayName,
            invoiceId: invoice.id,
            totalCost: invoice.totalCost,
            supplierIban: invoice.supplier.iban,
          })
      })

      invoice.autoReminderCount += 1
      await invoice.save()
    }
  }

  /**
   * Remind suppliers about payments awaiting approval.
   */
  async sendPendingApprovalReminders() {
    const pendingInvoices = await Invoice.query()
      .where('isPaid', false)
      .where('isPaymentRequested', true)
      .preload('buyer')
      .preload('supplier')

    // Group by supplier
    const bySupplier = new Map<number, typeof pendingInvoices>()
    for (const inv of pendingInvoices) {
      const existing = bySupplier.get(inv.supplierId) || []
      existing.push(inv)
      bySupplier.set(inv.supplierId, existing)
    }

    for (const [, invoices] of bySupplier) {
      const supplier = invoices[0].supplier
      if (supplier.isDisabled) continue

      const totalPending = invoices.reduce((sum, inv) => sum + inv.totalCost, 0)

      await mail.send((message) => {
        message
          .to(supplier.email)
          .subject(
            this.i18n.t('emails.pending_approval_subject', {
              count: invoices.length,
              total: totalPending,
            })
          )
          .htmlView('emails/pending_approval', {
            i18n: this.i18n,
            supplierName: supplier.displayName,
            invoices: invoices.map((inv) => ({
              id: inv.id,
              buyerName: inv.buyer.displayName,
              totalCost: inv.totalCost,
            })),
            totalPending,
          })
      })
    }
  }

  /**
   * Get count of emails sent today (for dashboard).
   */
  async getEmailStats() {
    const result = await db
      .from('invoices')
      .select(
        db.rawQuery(
          'COUNT(*) FILTER (WHERE is_paid = false AND is_payment_requested = false)::int as unpaid_count'
        ),
        db.rawQuery(
          'COUNT(*) FILTER (WHERE is_paid = false AND is_payment_requested = true)::int as pending_count'
        )
      )
      .first()

    return {
      unpaidCount: result?.unpaid_count ?? 0,
      pendingCount: result?.pending_count ?? 0,
    }
  }
}
