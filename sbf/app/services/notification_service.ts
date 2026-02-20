import mail from '@adonisjs/mail/services/main'
import i18nManager from '@adonisjs/i18n/services/main'
import env from '#start/env'
import User from '#models/user'
import Order from '#models/order'
import Invoice from '#models/invoice'
import Delivery from '#models/delivery'
import QrPaymentService from '#services/qr_payment_service'
import db from '@adonisjs/lucid/services/db'

export default class NotificationService {
  private get i18n() {
    return i18nManager.locale(i18nManager.defaultLocale)
  }

  private get appUrl() {
    return env.get('APP_URL') || `http://${env.get('HOST')}:${env.get('PORT')}`
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

    const addFavoriteUrl = isFavorite ? null : `${this.appUrl}/shop?add_favorite=${productId}`

    await mail.send((message) => {
      message
        .to(buyer.email)
        .subject(
          this.i18n.t('emails.purchase_subject', { product: order.delivery.product.displayName })
        )
        .htmlView('emails/purchase_confirmation', {
          i18n: this.i18n,
          orderId: order.id,
          buyerName: buyer.displayName,
          productName: order.delivery.product.displayName,
          price: order.delivery.price,
          supplierName: order.delivery.supplier.displayName,
          date: order.createdAt.toFormat('dd.MM.yyyy HH:mm'),
          addFavoriteUrl,
          appUrl: this.appUrl,
        })
    })
  }

  /**
   * Send a single batch purchase confirmation email for a kiosk basket checkout.
   * Aggregates multiple orders into one email with an item table.
   */
  async sendBatchPurchaseConfirmation(orders: Order[], buyerId: number) {
    const buyer = await User.find(buyerId)
    if (!buyer || !buyer.sendMailOnPurchase) return

    const loadedOrders = await Order.query()
      .whereIn(
        'id',
        orders.map((o) => o.id)
      )
      .preload('delivery', (q) => {
        q.preload('product')
        q.preload('supplier')
      })

    // Aggregate by delivery (product + price) to show grouped quantities
    const itemMap = new Map<
      number,
      { productName: string; supplierName: string; quantity: number; unitPrice: number }
    >()
    let totalCost = 0

    for (const order of loadedOrders) {
      const key = order.deliveryId
      const existing = itemMap.get(key)
      if (existing) {
        existing.quantity++
      } else {
        itemMap.set(key, {
          productName: order.delivery.product.displayName,
          supplierName: order.delivery.supplier.displayName,
          quantity: 1,
          unitPrice: order.delivery.price,
        })
      }
      totalCost += order.delivery.price
    }

    const items = Array.from(itemMap.values()).map((i) => ({
      ...i,
      subtotal: i.quantity * i.unitPrice,
    }))
    const date = loadedOrders[0]?.createdAt.toFormat('dd.MM.yyyy HH:mm') ?? ''

    await mail.send((message) => {
      message
        .to(buyer.email)
        .subject(
          this.i18n.t('emails.purchase_batch_subject', {
            count: orders.length,
            total: totalCost,
          })
        )
        .htmlView('emails/purchase_batch', {
          i18n: this.i18n,
          buyerName: buyer.displayName,
          items,
          totalCost,
          date,
          orderCount: orders.length,
          appUrl: this.appUrl,
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

    let qrImageData: string | null = null
    if (invoice.supplier.iban) {
      const qrService = new QrPaymentService()
      const qr = await qrService.generate({
        iban: invoice.supplier.iban,
        amount: invoice.totalCost,
        receiverName: invoice.supplier.displayName,
        payerName: buyer.displayName,
      })
      qrImageData = qr.imageData
    }

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
          qrImageData,
          confirmPaymentUrl: `${this.appUrl}/invoices?confirmId=${invoice.id}`,
          appUrl: this.appUrl,
        })
    })
  }

  /**
   * Notify supplier that a customer has marked an invoice as paid.
   */
  async sendPaymentRequestedNotification(invoice: Invoice) {
    await invoice.load('buyer')
    await invoice.load('supplier')

    const supplier = invoice.supplier
    if (supplier.isDisabled) return

    await mail.send((message) => {
      message
        .to(supplier.email)
        .subject(this.i18n.t('emails.payment_requested_subject', { id: invoice.id }))
        .htmlView('emails/payment_requested', {
          i18n: this.i18n,
          supplierName: supplier.displayName,
          buyerName: invoice.buyer.displayName,
          invoiceId: invoice.id,
          totalCost: invoice.totalCost,
          reviewUrl: `${this.appUrl}/supplier/payments?reviewId=${invoice.id}`,
          appUrl: this.appUrl,
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
          appUrl: this.appUrl,
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
            appUrl: this.appUrl,
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
            appUrl: this.appUrl,
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
            appUrl: this.appUrl,
          })
      })
    }
  }

  /**
   * Notify buyer that their order was cancelled by an admin (storno).
   * Call with a pre-loaded order (buyer, delivery.product, delivery.supplier).
   */
  async sendStornoNotification(order: Order) {
    const buyer = order.buyer
    if (buyer.isDisabled) return

    await mail.send((message) => {
      message
        .to(buyer.email)
        .subject(this.i18n.t('emails.order_cancelled_subject', { id: order.id }))
        .htmlView('emails/order_cancelled', {
          i18n: this.i18n,
          buyerName: buyer.displayName,
          orderId: order.id,
          productName: order.delivery.product.displayName,
          supplierName: order.delivery.supplier.displayName,
          price: order.delivery.price,
          appUrl: this.appUrl,
        })
    })
  }

  /**
   * Send welcome email to a newly auto-registered user.
   */
  async sendWelcomeEmail(user: User) {
    if (!user.email) return

    await mail.send((message) => {
      message
        .to(user.email)
        .subject(this.i18n.t('emails.welcome_subject'))
        .htmlView('emails/welcome', {
          i18n: this.i18n,
          name: user.displayName,
          keypadId: user.keypadId,
          appUrl: this.appUrl,
        })
    })
  }

  /**
   * Notify users who favourited a product that it's back in stock.
   */
  async sendRestockNotification(delivery: Delivery) {
    await delivery.load('product')
    await delivery.load('supplier')

    const favouriteUsers = await db
      .from('user_favorites')
      .join('users', 'user_favorites.user_id', 'users.id')
      .where('user_favorites.product_id', delivery.productId)
      .where('users.is_disabled', false)
      .whereNotNull('users.email')
      .select('users.id', 'users.display_name', 'users.email')

    for (const row of favouriteUsers) {
      await mail.send((message) => {
        message
          .to(row.email as string)
          .subject(
            this.i18n.t('emails.restock_subject', {
              productName: delivery.product.displayName,
            })
          )
          .htmlView('emails/restock', {
            i18n: this.i18n,
            name: row.display_name as string,
            productName: delivery.product.displayName,
            supplierName: delivery.supplier.displayName,
            amount: delivery.amountSupplied,
            price: delivery.price,
            shopUrl: this.appUrl,
            appUrl: this.appUrl,
          })
      })
    }
  }

  /**
   * Notify supplier that a buyer has withdrawn their payment confirmation.
   */
  async sendPaymentWithdrawnNotification(invoice: Invoice) {
    await invoice.load('buyer')
    await invoice.load('supplier')

    const supplier = invoice.supplier
    if (supplier.isDisabled) return

    await mail.send((message) => {
      message
        .to(supplier.email)
        .subject(this.i18n.t('emails.payment_withdrawn_subject', { id: invoice.id }))
        .htmlView('emails/payment_withdrawn', {
          i18n: this.i18n,
          supplierName: supplier.displayName,
          buyerName: invoice.buyer.displayName,
          invoiceId: invoice.id,
          totalCost: invoice.totalCost,
          appUrl: this.appUrl,
        })
    })
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
