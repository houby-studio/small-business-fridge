import mail from '@adonisjs/mail/services/main'
import router from '@adonisjs/core/services/router'
import i18nManager from '@adonisjs/i18n/services/main'
import env from '#start/env'
import type { DateTime } from 'luxon'
import User from '#models/user'
import Order from '#models/order'
import Invoice from '#models/invoice'
import type Delivery from '#models/delivery'
import DeliveryCorrection from '#models/delivery_correction'
import QrPaymentService from '#services/qr_payment_service'
import db from '@adonisjs/lucid/services/db'

export default class NotificationService {
  private get i18n() {
    return i18nManager.locale(i18nManager.defaultLocale)
  }

  private get appUrl() {
    return env.get('APP_URL') || `http://${env.get('HOST')}:${env.get('PORT')}`
  }

  private get appName() {
    return env.get('APP_NAME', 'Fridgora')
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
    const isKioskPurchase = order.channel === 'kiosk'
    if (!isKioskPurchase && !buyer.sendMailOnPurchase) return

    const productId = order.delivery.product.id
    const isFavorite = await db
      .from('user_favorites')
      .where('user_id', buyer.id)
      .where('product_id', productId)
      .first()

    // Signed link: the target writes to the database on a GET, so it must not be forgeable.
    // Expires well after the mail is useful, but not forever.
    const addFavoriteUrl = isFavorite
      ? null
      : this.appUrl +
        router.makeSignedUrl(
          '/shop/favorites/:productId',
          { productId },
          // disableRouteLookup: mails are also sent from the scheduler (console
          // environment), where the router is never committed and a lookup by name throws.
          { expiresIn: '30 days', purpose: 'add-favorite', disableRouteLookup: true }
        )

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
          price: order.unitPrice,
          supplierName: order.delivery.supplier.displayName,
          date: order.createdAt.toFormat('dd.MM.yyyy HH:mm'),
          addFavoriteUrl,
          appUrl: this.appUrl,
          appName: this.appName,
        })
    })
  }

  /**
   * Send a single batch purchase confirmation email for a kiosk basket checkout.
   * Aggregates multiple orders into one email with an item table.
   */
  async sendBatchPurchaseConfirmation(orders: Order[], buyerId: number) {
    const buyer = await User.find(buyerId)
    if (!buyer) return

    const loadedOrders = await Order.query()
      .whereIn(
        'id',
        orders.map((o) => o.id)
      )
      .preload('delivery', (q) => {
        q.preload('product')
        q.preload('supplier')
      })

    const isKioskBatch =
      loadedOrders.length > 0 && loadedOrders.every((order) => order.channel === 'kiosk')
    if (!isKioskBatch && !buyer.sendMailOnPurchase) return

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
          unitPrice: order.unitPrice,
        })
      }
      totalCost += order.unitPrice
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
          appName: this.appName,
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
    const qrImageData = await this.buildPaymentQr(invoice)

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
            price: o.unitPrice,
            date: o.createdAt.toFormat('dd.MM.yyyy'),
          })),
          supplierIban: invoice.supplier.iban,
          qrImageData,
          confirmPaymentUrl: `${this.appUrl}/invoices?confirmId=${invoice.id}`,
          appUrl: this.appUrl,
          appName: this.appName,
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
          appName: this.appName,
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
          appName: this.appName,
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

      const totalSpent = todayOrders.reduce((sum, o) => sum + o.unitPrice, 0)

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
              price: o.unitPrice,
              time: o.createdAt.toFormat('HH:mm'),
            })),
            totalSpent,
            orderCount: todayOrders.length,
            appUrl: this.appUrl,
            appName: this.appName,
          })
      })
    }
  }

  /**
   * Send unpaid invoice reminders to buyers.
   * Only sends for invoices older than UNPAID_REMINDER_MIN_AGE_DAYS days (default: 3).
   */
  async sendUnpaidInvoiceReminders() {
    const minAgeDays = env.get('UNPAID_REMINDER_MIN_AGE_DAYS') ?? 3
    const unpaidInvoices = await Invoice.query()
      .where('isPaid', false)
      .where('isPaymentRequested', false)
      .whereRaw("created_at <= NOW() - (? * INTERVAL '1 day')", [minAgeDays])
      .preload('buyer')
      .preload('supplier')

    for (const invoice of unpaidInvoices) {
      const buyer = invoice.buyer
      if (buyer.isDisabled) continue

      // Same QR payment code as in the original invoice notice, so the buyer can pay
      // straight from the reminder instead of digging up the first email.
      const qrImageData = await this.buildPaymentQr(invoice)

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
            qrImageData,
            appUrl: this.appUrl,
            appName: this.appName,
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
            appName: this.appName,
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
          price: order.unitPrice,
          appUrl: this.appUrl,
          appName: this.appName,
        })
    })
  }

  /**
   * Send welcome email to a newly auto-registered user.
   */
  async sendWelcomeEmail(user: User, options?: { emailVerificationUrl?: string | null }) {
    if (!user.email) return

    await mail.send((message) => {
      message
        .to(user.email)
        .subject(this.i18n.t('emails.welcome_subject', { app_name: this.appName }))
        .htmlView('emails/welcome', {
          i18n: this.i18n,
          name: user.displayName,
          keypadId: user.keypadId,
          emailVerificationUrl: options?.emailVerificationUrl ?? null,
          appUrl: this.appUrl,
          appName: this.appName,
        })
    })
  }

  async sendEmailVerificationEmail(params: {
    email: string
    displayName: string
    verificationUrl: string
  }) {
    await mail.send((message) => {
      message
        .to(params.email)
        .subject(this.i18n.t('emails.email_verification_subject', { app_name: this.appName }))
        .htmlView('emails/email_verification', {
          i18n: this.i18n,
          appName: this.appName,
          appUrl: this.appUrl,
          name: params.displayName,
          verificationUrl: params.verificationUrl,
        })
    })
  }

  async sendIbanChangeVerificationEmail(params: {
    email: string
    displayName: string
    iban: string
    verificationUrl: string
  }) {
    await mail.send((message) => {
      message
        .to(params.email)
        .subject(this.i18n.t('emails.iban_change_subject', { app_name: this.appName }))
        .htmlView('emails/iban_change_verification', {
          i18n: this.i18n,
          appName: this.appName,
          appUrl: this.appUrl,
          name: params.displayName,
          iban: params.iban,
          verificationUrl: params.verificationUrl,
        })
    })
  }

  /**
   * Send registration invitation email.
   */
  async sendRegistrationInvite(params: {
    email: string
    inviteUrl: string
    role: 'customer' | 'supplier' | 'admin'
    expiresAt: DateTime
  }) {
    await mail.send((message) => {
      message
        .to(params.email)
        .subject(this.i18n.t('emails.registration_invite_subject', { app_name: this.appName }))
        .htmlView('emails/registration_invite', {
          i18n: this.i18n,
          appName: this.appName,
          appUrl: this.appUrl,
          inviteUrl: params.inviteUrl,
          role: params.role,
          expiresAt: params.expiresAt.toFormat('dd.MM.yyyy HH:mm'),
        })
    })
  }

  /**
   * Send password reset email.
   */
  async sendPasswordResetEmail(params: { email: string; resetUrl: string }) {
    await mail.send((message) => {
      message
        .to(params.email)
        .subject(this.i18n.t('emails.password_reset_subject', { app_name: this.appName }))
        .htmlView('emails/password_reset', {
          i18n: this.i18n,
          appName: this.appName,
          appUrl: this.appUrl,
          resetUrl: params.resetUrl,
        })
    })
  }

  /** An AI tool (MCP client) was just granted lasting access to the user's account. */
  async sendMcpConnectedNotification(user: User, clientName: string) {
    if (user.isDisabled || !user.email) return

    await mail.send((message) => {
      message
        .to(user.email)
        .subject(this.i18n.t('emails.mcp_connected_subject', { client: clientName }))
        .htmlView('emails/mcp_connected', {
          i18n: this.i18n,
          name: user.displayName,
          client: clientName,
          profileUrl: `${this.appUrl}/profile`,
          appUrl: this.appUrl,
          appName: this.appName,
        })
    })
  }

  /**
   * A supplier's records (their deliveries, orders from their stock, invoices in their name)
   * were changed by someone else — typically an admin. The supplier learns what happened,
   * who did it and why, so nothing about their goods changes behind their back.
   */
  private async sendSupplierChangeNotice(
    supplier: User,
    actor: User,
    notice: { subject: string; heading: string; rows: Array<{ label: string; value: string }> }
  ) {
    if (supplier.id === actor.id || supplier.isDisabled || !supplier.email) return

    await mail.send((message) => {
      message
        .to(supplier.email)
        .subject(notice.subject)
        .htmlView('emails/supplier_change_notice', {
          i18n: this.i18n,
          name: supplier.displayName,
          heading: notice.heading,
          rows: [
            ...notice.rows,
            { label: this.i18n.t('emails.supplier_change_row_actor'), value: actor.displayName },
          ],
          ctaUrl: `${this.appUrl}/audit`,
          appUrl: this.appUrl,
          appName: this.appName,
        })
    })
  }

  private formatChange(from: string | number, to: string | number) {
    return from === to ? String(to) : `${from} → ${to}`
  }

  /** Delivery corrected or voided by someone other than its supplier. */
  async sendDeliveryCorrectionToSupplier(correctionId: number) {
    const correction = await DeliveryCorrection.query()
      .where('id', correctionId)
      .preload('actor')
      .preload('impersonator')
      .preload('delivery', (q) => {
        q.preload('product')
        q.preload('supplier')
      })
      .firstOrFail()

    const { delivery } = correction
    const t = (key: string, params?: Record<string, unknown>) => this.i18n.t(key, params)
    const money = (price: number) => t('emails.price_correction_amount', { price })
    const pieces = (count: number) => t('emails.price_correction_pieces', { count })
    const isVoid = correction.kind === 'void'

    const rows = [
      { label: t('emails.purchase_product'), value: delivery.product.displayName },
      {
        label: t('emails.supplier_change_row_amount'),
        value: this.formatChange(
          pieces(correction.oldAmountSupplied),
          pieces(correction.newAmountSupplied)
        ),
      },
      {
        label: t('emails.supplier_change_row_price'),
        value: this.formatChange(money(correction.oldPrice), money(correction.newPrice)),
      },
    ]
    if (!isVoid && correction.repricedOrderCount > 0) {
      rows.push({
        label: t('emails.supplier_change_row_repriced'),
        value: pieces(correction.repricedOrderCount),
      })
    }
    rows.push({ label: t('emails.price_correction_reason'), value: correction.reason })

    await this.sendSupplierChangeNotice(
      delivery.supplier,
      correction.impersonator ?? correction.actor,
      {
        subject: t(
          isVoid
            ? 'emails.supplier_change_subject_voided'
            : 'emails.supplier_change_subject_corrected',
          { productName: delivery.product.displayName }
        ),
        heading: t(
          isVoid
            ? 'emails.supplier_change_heading_voided'
            : 'emails.supplier_change_heading_corrected'
        ),
        rows,
      }
    )
  }

  /**
   * Admin storno of a purchase from the supplier's stock.
   * Call with a pre-loaded order (buyer, delivery.product, delivery.supplier).
   */
  async sendStornoToSupplier(order: Order, actor: User) {
    const t = (key: string, params?: Record<string, unknown>) => this.i18n.t(key, params)
    await this.sendSupplierChangeNotice(order.delivery.supplier, actor, {
      subject: t('emails.supplier_change_subject_storno', { id: order.id }),
      heading: t('emails.supplier_change_heading_storno'),
      rows: [
        { label: t('emails.supplier_change_row_order'), value: `#${order.id}` },
        { label: t('emails.purchase_product'), value: order.delivery.product.displayName },
        { label: t('emails.supplier_change_row_buyer'), value: order.buyer.displayName },
        {
          label: t('emails.supplier_change_row_price'),
          value: t('emails.price_correction_amount', { price: order.unitPrice }),
        },
        {
          label: t('emails.supplier_change_row_note'),
          value: t('emails.supplier_change_storno_note'),
        },
      ],
    })
  }

  /** Invoice issued in the supplier's name by someone else (admin invoicing a user). */
  async sendInvoiceGeneratedToSupplier(invoiceRef: Invoice, actor: User) {
    // Load a private copy: the caller hands the same instance to sendInvoiceNotice(), which
    // runs concurrently — reloading relations on the shared instance would clobber its
    // preloaded orders and break the buyer's invoice email.
    const invoice = await Invoice.query()
      .where('id', invoiceRef.id)
      .preload('supplier')
      .preload('buyer')
      .preload('orders')
      .firstOrFail()
    const t = (key: string, params?: Record<string, unknown>) => this.i18n.t(key, params)

    await this.sendSupplierChangeNotice(invoice.supplier, actor, {
      subject: t('emails.supplier_change_subject_invoice', { id: invoice.id }),
      heading: t('emails.supplier_change_heading_invoice'),
      rows: [
        { label: t('emails.supplier_change_row_invoice'), value: `#${invoice.id}` },
        { label: t('emails.supplier_change_row_buyer'), value: invoice.buyer.displayName },
        {
          label: t('emails.supplier_change_row_items'),
          value: t('emails.price_correction_pieces', { count: invoice.orders.length }),
        },
        {
          label: t('emails.supplier_change_row_total'),
          value: t('emails.price_correction_amount', { price: invoice.totalCost }),
        },
      ],
    })
  }

  /**
   * Tell every buyer whose uninvoiced purchases were repriced by a delivery correction what
   * changed, who changed it and why. One email per buyer, covering all their units.
   */
  async sendPriceCorrectionNotifications(correctionId: number, orderIds?: number[]) {
    const correction = await DeliveryCorrection.query()
      .where('id', correctionId)
      .preload('actor')
      .preload('impersonator')
      .preload('delivery', (q) => {
        q.preload('product')
        q.preload('supplier')
      })
      .firstOrFail()

    // Use the orders captured inside the correction's transaction when given: a second
    // correction right after this one re-points price_correction_id, and this email would
    // otherwise find no orders at all.
    const orders = await Order.query()
      .if(
        orderIds !== undefined,
        (q) => q.whereIn('id', orderIds ?? []),
        (q) => q.where('priceCorrectionId', correction.id)
      )
      .preload('buyer')
      .orderBy('id', 'asc')

    const byBuyer = new Map<number, Order[]>()
    for (const order of orders) {
      const list = byBuyer.get(order.buyerId) ?? []
      list.push(order)
      byBuyer.set(order.buyerId, list)
    }

    for (const buyerOrders of byBuyer.values()) {
      const buyer = buyerOrders[0].buyer
      if (buyer.isDisabled || !buyer.email) continue

      const count = buyerOrders.length
      const oldTotal = count * correction.oldPrice
      const newTotal = count * correction.newPrice
      const difference = newTotal - oldTotal

      await mail.send((message) => {
        message
          .to(buyer.email)
          .subject(
            this.i18n.t('emails.price_correction_subject', {
              productName: correction.delivery.product.displayName,
            })
          )
          .htmlView('emails/price_correction', {
            i18n: this.i18n,
            name: buyer.displayName,
            productName: correction.delivery.product.displayName,
            supplierName: correction.delivery.supplier.displayName,
            // The admin really behind the change when they impersonated the supplier.
            actorName: (correction.impersonator ?? correction.actor).displayName,
            reason: correction.reason,
            oldPrice: correction.oldPrice,
            newPrice: correction.newPrice,
            count,
            oldTotal,
            newTotal,
            difference: difference > 0 ? `+${difference}` : String(difference),
            ordersUrl: `${this.appUrl}/orders`,
            appUrl: this.appUrl,
            appName: this.appName,
          })
      })
    }
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
            appName: this.appName,
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
          appName: this.appName,
        })
    })
  }

  /**
   * Build the SPD QR payment code (PNG data URL) for an invoice, or null when the
   * supplier has no IBAN. Expects `invoice.buyer` and `invoice.supplier` to be loaded.
   */
  private async buildPaymentQr(invoice: Invoice): Promise<string | null> {
    const supplierIban = invoice.supplier.iban
    if (!supplierIban) return null

    const qr = await new QrPaymentService().generate({
      iban: supplierIban,
      amount: invoice.totalCost,
      receiverName: invoice.supplier.displayName,
      payerName: invoice.buyer.displayName,
    })
    return qr.imageData
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
