import '#tests/test_context'
import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import OrderService from '#services/order_service'
import DeliveryService from '#services/delivery_service'
import InvoiceService from '#services/invoice_service'
import AdminService from '#services/admin_service'
import NotificationService from '#services/notification_service'
import { settleSideEffects } from '#services/side_effects'
import InventoryService from '#services/inventory_service'
import StockHistoryService from '#services/stock_history_service'
import DeliveryCorrection from '#models/delivery_correction'
import StockDraft from '#models/stock_draft'
import StockDraftItem from '#models/stock_draft_item'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import type User from '#models/user'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('user_favorites').delete()
  await db.from('orders').delete()
  await db.from('invoices').delete()
  await db.from('delivery_corrections').delete()
  await db.from('stock_adjustments').delete()
  await db.from('inventory_count_items').delete()
  await db.from('inventory_counts').delete()
  await db.from('stock_draft_items').delete()
  await db.from('stock_drafts').delete()
  await db.from('deliveries').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('users').delete()
}

/**
 * Every rendered email must be fully translated — a missing key renders as
 * "translation missing: …" in the subject or body instead of failing loudly.
 */
function assertFullyTranslated(
  assert: { notInclude: (haystack: string, needle: string, message?: string) => void },
  messages: Array<{ toJSON: () => unknown }>
) {
  for (const message of messages) {
    assert.notInclude(JSON.stringify(message.toJSON()), 'translation missing')
  }
}

async function setup(
  options: { amount?: number; price?: number; purchasePrice?: number | null } = {}
) {
  const supplier = await UserFactory.apply('supplier').create()
  const category = await CategoryFactory.create()
  const product = await ProductFactory.merge({ categoryId: category.id }).create()
  const delivery = await DeliveryFactory.merge({
    supplierId: supplier.id,
    productId: product.id,
    amountSupplied: options.amount ?? 10,
    amountLeft: options.amount ?? 10,
    price: options.price ?? 1,
    purchasePrice: options.purchasePrice ?? null,
  }).create()
  return { supplier, product, delivery }
}

const inertia = { 'x-inertia': 'true', 'x-inertia-version': '1' }

test.group('Web Supplier - warnings before a draft is stocked', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a repeated delivery is not stocked until the warning is confirmed', async ({
    client,
    assert,
  }) => {
    const { supplier, product } = await setup({ amount: 12, price: 25 })
    const draft = await StockDraft.create({
      supplierId: supplier.id,
      source: 'web',
      status: 'open',
    })
    const items = [{ productId: product.id, amount: 12, price: 25 }]

    const warned = await client
      .post(`/supplier/stock/drafts/${draft.id}/commit`)
      .headers(inertia)
      .header('referer', `/supplier/stock/drafts/${draft.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ items })
      .redirects(1)

    warned.assertStatus(200)
    const warnings = warned.body().props.flash.draftWarnings
    assert.lengthOf(warnings, 1)
    assert.equal(warnings[0].index, 0)
    assert.equal(warnings[0].productId, product.id)
    assert.equal(warnings[0].productName, product.displayName)
    assert.equal(warnings[0].duplicate.amount, 12)
    assert.isNull(warnings[0].unusualPrice)
    // Nothing stocked, the reviewed lines are kept and the page shows them.
    assert.lengthOf(await db.from('deliveries').where('product_id', product.id), 1)
    assert.lengthOf(await StockDraftItem.query().where('stockDraftId', draft.id), 1)
    assert.equal(warned.body().props.draft.status, 'open')
    assert.equal(warned.body().props.draft.items[0].productId, product.id)

    const confirmed = await client
      .post(`/supplier/stock/drafts/${draft.id}/commit`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ items, confirmWarnings: true })
      .redirects(0)

    confirmed.assertStatus(302)
    assert.equal(confirmed.header('location'), '/supplier/stock')
    assert.lengthOf(await db.from('deliveries').where('product_id', product.id), 2)
    await draft.refresh()
    assert.equal(draft.status, 'committed')
  })

  test('an unusual price is flagged before stocking', async ({ client, assert }) => {
    const { product } = await setup({ amount: 12, price: 25 })
    const other = await UserFactory.apply('supplier').create()
    const draft = await StockDraft.create({ supplierId: other.id, source: 'web', status: 'open' })

    const warned = await client
      .post(`/supplier/stock/drafts/${draft.id}/commit`)
      .headers(inertia)
      .header('referer', `/supplier/stock/drafts/${draft.id}`)
      .loginAs(other)
      .withCsrfToken()
      .json({ items: [{ productId: product.id, amount: 12, price: 250 }] })
      .redirects(1)

    const [warning] = warned.body().props.flash.draftWarnings
    assert.isNull(warning.duplicate)
    assert.equal(warning.unusualPrice.lastPrice, 25)
    assert.lengthOf(await db.from('deliveries').where('supplier_id', other.id), 0)
  })
})

test.group('Web Supplier - delivery corrections', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('PUT corrects the price of uninvoiced purchases and emails the buyers', async ({
    client,
    assert,
  }) => {
    const fakeMailer = mail.fake()
    try {
      const { supplier, delivery } = await setup({ amount: 10, price: 1 })
      const buyer = await UserFactory.create()
      await new OrderService().purchase(buyer.id, delivery.id, 'web')
      await new OrderService().purchase(buyer.id, delivery.id, 'web')

      const response = await client
        .put(`/supplier/deliveries/${delivery.id}`)
        .loginAs(supplier)
        .withCsrfToken()
        .json({ amount: 10, price: 25, reason: 'Price typo' })
        .redirects(0)

      response.assertStatus(302)

      const orders = await db.from('orders').where('delivery_id', delivery.id)
      assert.deepEqual(
        orders.map((o) => Number(o.unit_price)),
        [25, 25]
      )

      const correction = await DeliveryCorrection.findByOrFail('deliveryId', delivery.id)
      assert.equal(correction.reason, 'Price typo')
      assert.equal(correction.repricedOrderCount, 2)

      // Sent after the response — wait for exactly those e-mails.
      assert.deepEqual(await settleSideEffects(), [])
      fakeMailer.messages.assertSent((message) => message.hasTo(buyer.email))
      assertFullyTranslated(assert, fakeMailer.messages.sent())
    } finally {
      mail.restore()
    }
  })

  test('PUT corrects the purchase price alone and returns to the history', async ({
    client,
    assert,
  }) => {
    const { supplier, delivery } = await setup({ amount: 10, price: 20, purchasePrice: 14.9 })
    const buyer = await UserFactory.create()
    await new OrderService().purchase(buyer.id, delivery.id, 'web')

    const response = await client
      .put(`/supplier/deliveries/${delivery.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .header('referer', '/supplier/deliveries?scope=all&page=2')
      .json({ amount: 10, price: 20, purchasePrice: 12.5, reason: 'Receipt says 12.50' })
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/supplier/deliveries?scope=all&page=2')
    await delivery.refresh()
    assert.equal(delivery.purchasePrice, 12.5)
    assert.equal(delivery.price, 20)
    const correction = await DeliveryCorrection.findByOrFail('deliveryId', delivery.id)
    assert.equal(correction.oldPurchasePrice, 14.9)
    assert.equal(correction.newPurchasePrice, 12.5)
    assert.equal(correction.repricedOrderCount, 0)
    const [order] = await db.from('orders').where('delivery_id', delivery.id)
    assert.equal(Number(order.unit_price), 20)

    // Three decimals are refused by validation before the service sees them.
    const refused = await client
      .put(`/supplier/deliveries/${delivery.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ amount: 10, price: 20, purchasePrice: 12.505, reason: 'Too precise' })
      .redirects(0)
    refused.assertStatus(302)
    await delivery.refresh()
    assert.equal(delivery.purchasePrice, 12.5)
  })

  test('PUT rejects an amount below the sold count', async ({ client, assert }) => {
    const { supplier, delivery } = await setup({ amount: 5, price: 10 })
    const buyer = await UserFactory.create()
    await new OrderService().purchase(buyer.id, delivery.id, 'web')
    await new OrderService().purchase(buyer.id, delivery.id, 'web')

    const response = await client
      .put(`/supplier/deliveries/${delivery.id}`)
      .headers(inertia)
      .header('referer', '/supplier/deliveries')
      .loginAs(supplier)
      .withCsrfToken()
      .json({ amount: 1, price: 10, reason: 'Wrong count' })
      .redirects(1)

    response.assertStatus(200)
    assert.equal(response.body().props.flash.alert.type, 'danger')
    const row = await db.from('deliveries').where('id', delivery.id).first()
    assert.equal(Number(row.amount_supplied), 5)
    assert.lengthOf(await DeliveryCorrection.all(), 0)
  })

  test('PUT cannot increase the stocked amount', async ({ client, assert }) => {
    const { supplier, delivery } = await setup({ amount: 5, price: 10 })

    const response = await client
      .put(`/supplier/deliveries/${delivery.id}`)
      .headers(inertia)
      .header('referer', '/supplier/deliveries')
      .loginAs(supplier)
      .withCsrfToken()
      .json({ amount: 50, price: 10, reason: 'Top up' })
      .redirects(1)

    response.assertStatus(200)
    assert.equal(response.body().props.flash.alert.type, 'danger')
    const row = await db.from('deliveries').where('id', delivery.id).first()
    assert.equal(Number(row.amount_supplied), 5)
    assert.equal(Number(row.amount_left), 5)
  })

  test('PUT without a reason is rejected by validation', async ({ client, assert }) => {
    const { supplier, delivery } = await setup({ amount: 5, price: 10 })

    const response = await client
      .put(`/supplier/deliveries/${delivery.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ amount: 4, price: 10, reason: ' ' })
      .redirects(0)

    response.assertStatus(302)
    const row = await db.from('deliveries').where('id', delivery.id).first()
    assert.equal(Number(row.amount_supplied), 5)
  })

  test('another supplier cannot correct the delivery', async ({ client, assert }) => {
    const { delivery } = await setup({ amount: 5, price: 10 })
    const other = await UserFactory.apply('supplier').create()

    const response = await client
      .put(`/supplier/deliveries/${delivery.id}`)
      .loginAs(other)
      .withCsrfToken()
      .json({ amount: 4, price: 99, reason: 'Not mine' })
      .redirects(0)

    response.assertStatus(302)
    const row = await db.from('deliveries').where('id', delivery.id).first()
    assert.equal(Number(row.price), 10)
    assert.equal(Number(row.amount_supplied), 5)
  })

  test('a customer cannot correct deliveries', async ({ client, assert }) => {
    const { delivery } = await setup({ amount: 5, price: 10 })
    const customer = await UserFactory.create()

    const response = await client
      .put(`/supplier/deliveries/${delivery.id}`)
      .loginAs(customer)
      .withCsrfToken()
      .json({ amount: 4, price: 99, reason: 'Not mine' })
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/')
    const row = await db.from('deliveries').where('id', delivery.id).first()
    assert.equal(Number(row.price), 10)
  })

  test('DELETE voids an unsold delivery', async ({ client, assert }) => {
    const { supplier, delivery } = await setup({ amount: 12, price: 30 })

    const response = await client
      .delete(`/supplier/deliveries/${delivery.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ reason: 'Stocked twice' })
      .redirects(0)

    response.assertStatus(302)
    const row = await db.from('deliveries').where('id', delivery.id).first()
    assert.isNotNull(row.voided_at)
    assert.equal(Number(row.amount_left), 0)
  })

  test('DELETE refuses a delivery someone bought from', async ({ client, assert }) => {
    const { supplier, delivery } = await setup({ amount: 12, price: 30 })
    const buyer = await UserFactory.create()
    await new OrderService().purchase(buyer.id, delivery.id, 'web')

    const response = await client
      .delete(`/supplier/deliveries/${delivery.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ reason: 'Stocked twice' })
      .redirects(0)

    response.assertStatus(302)
    const row = await db.from('deliveries').where('id', delivery.id).first()
    assert.isNull(row.voided_at)
    assert.equal(Number(row.amount_left), 11)
  })

  test('the history page exposes correction stats and permissions', async ({ client, assert }) => {
    const { supplier, delivery } = await setup({ amount: 10, price: 5 })
    const buyer = await UserFactory.create()
    await new OrderService().purchase(buyer.id, delivery.id, 'web')

    const response = await client
      .get('/supplier/deliveries')
      .loginAs(supplier)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')

    response.assertStatus(200)
    const row = response.body().props.recentDeliveries.data[0]
    assert.equal(row.id, delivery.id)
    assert.equal(row.soldCount, 1)
    assert.equal(row.uninvoicedCount, 1)
    assert.equal(row.uninvoicedBuyerCount, 1)
    assert.equal(row.invoicedCount, 0)
    assert.isTrue(row.canCorrect)
  })

  test('scope=all lists other suppliers without letting them be corrected', async ({
    client,
    assert,
  }) => {
    const { delivery } = await setup({ amount: 10, price: 5 })
    const other = await UserFactory.apply('supplier').create()

    const mine = await client.get('/supplier/deliveries?scope=mine').loginAs(other).headers(inertia)
    assert.lengthOf(mine.body().props.recentDeliveries.data, 0)
    assert.equal(mine.body().props.filters.scope, 'mine')
    assert.equal(mine.body().props.filters.type, 'deliveries')
    // The other table is not loaded for this view.
    assert.deepEqual(mine.body().props.adjustments.data, [])

    // The whole fridge is the default (PLAN4 P1).
    const all = await client.get('/supplier/deliveries').loginAs(other).headers(inertia)
    const row = all.body().props.recentDeliveries.data[0]
    assert.equal(row.id, delivery.id)
    assert.isFalse(row.canCorrect)
    assert.equal(all.body().props.filters.scope, 'all')
  })

  test('type=adjustments lists write-offs and inventory differences of my lots', async ({
    client,
    assert,
  }) => {
    const { supplier, product, delivery } = await setup({
      amount: 10,
      price: 5,
      purchasePrice: 3.5,
    })
    const colleague = await UserFactory.apply('supplier').create()
    // A colleague writes off two pieces — FIFO takes them from my lot.
    await new InventoryService().writeOff(colleague, {
      productId: product.id,
      quantity: 2,
      reason: 'expired',
      note: 'prošlé',
    })

    const page = await client
      .get('/supplier/deliveries?type=adjustments&scope=mine')
      .loginAs(supplier)
      .headers(inertia)
    page.assertStatus(200)
    const { adjustments, recentDeliveries, filters } = page.body().props
    assert.equal(filters.type, 'adjustments')
    assert.deepEqual(recentDeliveries.data, [])
    assert.equal(adjustments.meta.total, 1)
    const [row] = adjustments.data
    assert.equal(row.productId, product.id)
    assert.equal(row.productName, product.displayName)
    assert.equal(row.kind, 'loss')
    assert.equal(row.quantity, 2)
    assert.equal(row.reason, 'expired')
    assert.equal(row.note, 'prošlé')
    assert.equal(row.unitCost, 3.5)
    assert.equal(row.unitPrice, 5)
    assert.equal(row.lotSupplierName, supplier.displayName)
    assert.equal(row.actorName, colleague.displayName)
    assert.isNull(row.inventoryCountId)
    assert.isString(row.createdAt)
    await delivery.refresh()
    assert.equal(delivery.amountLost, 2)

    // The colleague recorded it, but it is not their loss — only scope=all shows it to them.
    const theirs = await client
      .get('/supplier/deliveries?type=adjustments&scope=mine')
      .loginAs(colleague)
      .headers(inertia)
    assert.deepEqual(theirs.body().props.adjustments.data, [])
    const everyone = await client
      .get('/supplier/deliveries?type=adjustments&scope=all')
      .loginAs(colleague)
      .headers(inertia)
    assert.equal(everyone.body().props.adjustments.meta.total, 1)

    const byProduct = await client
      .get(`/supplier/deliveries?type=adjustments&productId=${product.id + 1}`)
      .loginAs(supplier)
      .headers(inertia)
    assert.deepEqual(byProduct.body().props.adjustments.data, [])
  })
})

test.group('Supplier is told when someone else changes their records', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('an admin correction emails the supplier, the supplier fixing their own does not', async ({
    assert,
  }) => {
    const fakeMailer = mail.fake()
    try {
      const { supplier, delivery } = await setup({ amount: 10, price: 1 })
      const admin = await UserFactory.apply('admin').create()
      const service = new DeliveryService()

      await service.correctDelivery(supplier, delivery.id, {
        amount: 9,
        price: 1,
        reason: 'Own fix',
      })
      assert.deepEqual(await settleSideEffects(), [])
      assert.lengthOf(fakeMailer.messages.sent(), 0)

      await service.correctDelivery(admin, delivery.id, {
        amount: 9,
        price: 25,
        reason: 'Admin fixed the price',
      })

      assert.deepEqual(await settleSideEffects(), [])
      fakeMailer.messages.assertSent((message) => message.hasTo(supplier.email))

      const voided = await setup({ amount: 4, price: 10 })
      await service.voidDelivery(admin, voided.delivery.id, 'Duplicate')
      assert.deepEqual(await settleSideEffects(), [])
      fakeMailer.messages.assertSent((message) => message.hasTo(voided.supplier.email))
      assertFullyTranslated(assert, fakeMailer.messages.sent())
    } finally {
      mail.restore()
    }
  })

  test('admin storno of an order emails the supplier', async ({ assert }) => {
    const fakeMailer = mail.fake()
    try {
      const { supplier, delivery } = await setup({ amount: 5, price: 20 })
      const admin = await UserFactory.apply('admin').create()
      const buyer = await UserFactory.create()
      const order = await new OrderService().purchase(buyer.id, delivery.id, 'web')
      await order.load('buyer')
      await order.load('delivery', (q) => {
        q.preload('product')
        q.preload('supplier')
      })

      await new NotificationService().sendStornoToSupplier(order, admin)
      fakeMailer.messages.assertSent((message) => message.hasTo(supplier.email))

      // An admin cancelling a purchase from their own stock gets no self-notice.
      const ownStock = await setup({ amount: 5, price: 20 })
      const ownOrder = await new OrderService().purchase(buyer.id, ownStock.delivery.id, 'web')
      await ownOrder.load('buyer')
      await ownOrder.load('delivery', (q) => {
        q.preload('product')
        q.preload('supplier')
      })
      assertFullyTranslated(assert, fakeMailer.messages.sent())
      const before = fakeMailer.messages.sent().length
      await new NotificationService().sendStornoToSupplier(ownOrder, ownStock.supplier)
      assert.lengthOf(fakeMailer.messages.sent(), before)
    } finally {
      mail.restore()
    }
  })

  test('admin invoicing a user emails every supplier involved', async ({ assert }) => {
    const fakeMailer = mail.fake()
    try {
      const { supplier, delivery } = await setup({ amount: 5, price: 20 })
      const admin = await UserFactory.apply('admin').create()
      const buyer = await UserFactory.create()
      await new OrderService().purchase(buyer.id, delivery.id, 'web')

      const invoices = await new InvoiceService().generateInvoicesForUser(admin.id, buyer.id)
      for (const invoice of invoices) {
        await new NotificationService().sendInvoiceGeneratedToSupplier(invoice, admin)
      }
      fakeMailer.messages.assertSent((message) => message.hasTo(supplier.email))
      assertFullyTranslated(assert, fakeMailer.messages.sent())
    } finally {
      mail.restore()
    }
  })

  test('the buyer still gets the invoice email when the supplier notice runs alongside it', async ({
    assert,
  }) => {
    const fakeMailer = mail.fake()
    try {
      const { supplier, delivery } = await setup({ amount: 5, price: 20 })
      const admin = await UserFactory.apply('admin').create()
      const buyer = await UserFactory.create()
      await new OrderService().purchase(buyer.id, delivery.id, 'web')

      const [invoice] = await new InvoiceService().generateInvoicesForUser(admin.id, buyer.id)
      const notifications = new NotificationService()

      // The supplier notice must not touch the shared instance: sendInvoiceNotice() relies on
      // the orders it preloaded (with their products) while both run concurrently.
      await invoice.load('orders', (q) => q.preload('delivery', (dq) => dq.preload('product')))
      await notifications.sendInvoiceGeneratedToSupplier(invoice, admin)
      assert.exists(invoice.orders[0].delivery?.product)

      // Same shared instance, concurrently — exactly what the admin controller does.
      await Promise.all([
        notifications.sendInvoiceNotice(invoice),
        notifications.sendInvoiceGeneratedToSupplier(invoice, admin),
      ])

      fakeMailer.messages.assertSent((message) => message.hasTo(buyer.email))
      fakeMailer.messages.assertSent((message) => message.hasTo(supplier.email))
      assertFullyTranslated(assert, fakeMailer.messages.sent())
    } finally {
      mail.restore()
    }
  })

  test('the supplier activity page says who made a foreign change', async ({ client, assert }) => {
    const { supplier, delivery } = await setup({ amount: 10, price: 1 })
    const admin = await UserFactory.apply('admin').create()
    await new DeliveryService().correctDelivery(admin, delivery.id, {
      amount: 10,
      price: 25,
      reason: 'Admin fixed the price',
    })
    await new DeliveryService().correctDelivery(supplier, delivery.id, {
      amount: 9,
      price: 25,
      reason: 'Own fix',
    })

    const response = await client
      .get('/audit')
      .loginAs(supplier)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')

    response.assertStatus(200)
    const rows: any[] = response.body().props.logs.data
    const corrections = rows.filter((row) => row.action === 'delivery.corrected')
    assert.lengthOf(corrections, 2)
    const foreign = corrections.find((row) => !row.actorIsMe)
    assert.equal(foreign.user.displayName, admin.displayName)
    assert.isTrue(corrections.some((row) => row.actorIsMe))
  })
})

test.group('Audit records the real admin behind an impersonated action', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a correction made while impersonating the supplier names the admin', async ({
    client,
    assert,
  }) => {
    const { supplier, delivery } = await setup({ amount: 10, price: 5 })
    const admin = await UserFactory.apply('admin').create()
    const impersonation = {
      __impersonation: { byId: admin.id, asId: supplier.id, asName: supplier.displayName },
    }

    const response = await client
      .put(`/supplier/deliveries/${delivery.id}`)
      .loginAs(admin)
      .withSession(impersonation)
      .withCsrfToken()
      .json({ amount: 8, price: 5, reason: 'Fixed while impersonating' })
      .redirects(0)
    response.assertStatus(302)

    // The action is recorded as the supplier's (they are the effective user) …
    const log = await db.from('audit_logs').where('action', 'delivery.corrected').firstOrFail()
    assert.equal(log.user_id, supplier.id)
    // … but the admin who really did it is kept.
    assert.deepEqual(log.metadata.impersonatedBy, { id: admin.id, name: admin.displayName })

    // The supplier's own activity page shows it was done on their behalf.
    const activity = await client
      .get('/audit')
      .loginAs(supplier)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')
    const row = (activity.body().props.logs.data as any[]).find(
      (r) => r.action === 'delivery.corrected'
    )
    assert.equal(row.impersonatedBy, admin.displayName)
  })

  test('an ordinary action carries no impersonation marker', async ({ client, assert }) => {
    const { supplier, delivery } = await setup({ amount: 10, price: 5 })

    await client
      .put(`/supplier/deliveries/${delivery.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ amount: 8, price: 5, reason: 'Own fix' })
      .redirects(0)

    const log = await db.from('audit_logs').where('action', 'delivery.corrected').firstOrFail()
    assert.notProperty(log.metadata, 'impersonatedBy')
  })
})

test.group('Corrections under contention and impersonation', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a storno and a price correction of the same delivery do not deadlock', async ({
    assert,
  }) => {
    const { supplier, delivery } = await setup({ amount: 10, price: 5 })
    const buyer = await UserFactory.create()
    const orders = await Promise.all(
      [1, 2, 3].map(() => new OrderService().purchase(buyer.id, delivery.id, 'web'))
    )

    const results = await Promise.allSettled([
      new AdminService().stornoOrder(orders[0].id, supplier.id),
      new DeliveryService().correctDelivery(supplier, delivery.id, {
        amount: 10,
        price: 7,
        reason: 'Concurrent fix',
      }),
      new AdminService().stornoOrder(orders[1].id, supplier.id),
    ])

    for (const result of results) {
      assert.equal(result.status, 'fulfilled', String((result as PromiseRejectedResult).reason))
    }
    await delivery.refresh()
    assert.equal(delivery.amountLeft, 9)
  })

  test('two quick corrections still email the buyers of the first one', async ({ assert }) => {
    const fakeMailer = mail.fake()
    try {
      const { supplier, delivery } = await setup({ amount: 10, price: 20 })
      const buyer = await UserFactory.create()
      await new OrderService().purchase(buyer.id, delivery.id, 'web')

      await new DeliveryService().correctDelivery(supplier, delivery.id, {
        amount: 10,
        price: 25,
        reason: 'First',
      })
      await new DeliveryService().correctDelivery(supplier, delivery.id, {
        amount: 10,
        price: 30,
        reason: 'Second',
      })

      // Both e-mails run after the second correction already re-pointed the orders.
      assert.deepEqual(await settleSideEffects(), [])
      const toBuyer = fakeMailer.messages.sent().filter((message) => message.hasTo(buyer.email))
      assert.lengthOf(toBuyer, 2)
    } finally {
      mail.restore()
    }
  })

  test('a correction made while impersonating names the admin and notifies the supplier', async ({
    client,
    assert,
  }) => {
    const fakeMailer = mail.fake()
    try {
      const { supplier, delivery } = await setup({ amount: 10, price: 5 })
      const admin = await UserFactory.apply('admin').create()

      await client
        .put(`/supplier/deliveries/${delivery.id}`)
        .loginAs(admin)
        .withSession({
          __impersonation: { byId: admin.id, asId: supplier.id, asName: supplier.displayName },
        })
        .withCsrfToken()
        .json({ amount: 9, price: 5, reason: 'Admin as supplier' })
        .redirects(0)

      const correction = await DeliveryCorrection.findByOrFail('deliveryId', delivery.id)
      assert.equal(correction.actorId, supplier.id)
      assert.equal(correction.impersonatorId, admin.id)

      assert.deepEqual(await settleSideEffects(), [])
      const notice = fakeMailer.messages.sent().find((message) => message.hasTo(supplier.email))
      assert.exists(notice)
      assert.include(JSON.stringify(notice!.toJSON()), admin.displayName)
    } finally {
      mail.restore()
    }
  })
})

test.group('Controllers trigger the notifications', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('an admin correction over HTTP triggers the supplier notice and buyer emails', async ({
    client,
    assert,
  }) => {
    const { delivery } = await setup({ amount: 10, price: 5 })
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    await new OrderService().purchase(buyer.id, delivery.id, 'web')

    // Record the calls instead of sending: the tests above cover the email contents.
    const calls: string[] = []
    const proto = NotificationService.prototype
    const original = {
      supplier: proto.sendDeliveryCorrectionToSupplier,
      buyers: proto.sendPriceCorrectionNotifications,
    }
    proto.sendDeliveryCorrectionToSupplier = async () => {
      calls.push('supplier')
    }
    proto.sendPriceCorrectionNotifications = async () => {
      calls.push('buyers')
    }
    try {
      const response = await client
        .put(`/supplier/deliveries/${delivery.id}`)
        .loginAs(admin)
        .withCsrfToken()
        .json({ amount: 10, price: 6, reason: 'Admin fix' })
        .redirects(0)
      response.assertStatus(302)
      await settleSideEffects()
    } finally {
      proto.sendDeliveryCorrectionToSupplier = original.supplier
      proto.sendPriceCorrectionNotifications = original.buyers
    }

    assert.sameMembers(calls, ['supplier', 'buyers'])
  })
})

test.group('Web Supplier - history privacy, filters and odd input', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test("a colleague's purchase prices stay private in the history", async ({ client, assert }) => {
    const { supplier, product } = await setup({ amount: 10, price: 5, purchasePrice: 3.5 })
    await new InventoryService().writeOff(supplier, {
      productId: product.id,
      quantity: 1,
      reason: 'damaged',
    })
    const colleague = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()

    const deliveries = await client
      .get('/supplier/deliveries?scope=all')
      .loginAs(colleague)
      .headers(inertia)
    const [lot] = deliveries.body().props.recentDeliveries.data
    assert.isNull(lot.purchasePrice)
    // The selling price is public.
    assert.equal(lot.price, 5)

    const adjustments = await client
      .get('/supplier/deliveries?type=adjustments&scope=all')
      .loginAs(colleague)
      .headers(inertia)
    const [loss] = adjustments.body().props.adjustments.data
    assert.isNull(loss.unitCost)
    assert.equal(loss.unitPrice, 5)

    // The owner and an admin still see it.
    for (const viewer of [supplier, admin]) {
      const seen = await client
        .get('/supplier/deliveries?scope=all')
        .loginAs(viewer)
        .headers(inertia)
      assert.equal(seen.body().props.recentDeliveries.data[0].purchasePrice, 3.5)
      const seenLoss = await client
        .get('/supplier/deliveries?type=adjustments&scope=all')
        .loginAs(viewer)
        .headers(inertia)
      assert.equal(seenLoss.body().props.adjustments.data[0].unitCost, 3.5)
    }
  })

  test('reason=inventory lists the losses nobody explained yet (UX-27)', async ({
    client,
    assert,
  }) => {
    const { supplier, product } = await setup({ amount: 10, price: 5 })
    const inventory = new InventoryService()
    await inventory.writeOff(supplier, { productId: product.id, quantity: 1, reason: 'expired' })
    // An inventory that finds 2 pieces missing: a loss without a reason yet.
    await inventory.commitCount(supplier, {
      scope: 'all',
      items: [{ productId: product.id, expected: 9, counted: 7 }],
    })

    const response = await client
      .get('/supplier/deliveries?type=adjustments&scope=mine&reason=inventory')
      .loginAs(supplier)
      .headers(inertia)
    response.assertStatus(200)
    const { adjustments, filters } = response.body().props
    assert.equal(filters.reason, 'inventory')
    assert.equal(adjustments.meta.total, 1)
    assert.equal(adjustments.data[0].quantity, 2)
    assert.equal(adjustments.data[0].reason, 'inventory')

    // The MCP tool narrows by where a row came from: a count, or a write-off by hand.
    const history = new StockHistoryService()
    const fromCount = await history.listAdjustments(supplier, 1, 20, { origin: 'inventory' })
    assert.deepEqual(
      fromCount.data.map((row) => row.reason),
      ['inventory']
    )
    const byHand = await history.listAdjustments(supplier, 1, 20, { origin: 'write_off' })
    assert.deepEqual(
      byHand.data.map((row) => row.reason),
      ['expired']
    )

    // An unknown reason is ignored rather than matching nothing.
    const unknown = await client
      .get('/supplier/deliveries?type=adjustments&reason=drop')
      .loginAs(supplier)
      .headers(inertia)
    assert.equal(unknown.body().props.filters.reason, '')
    assert.equal(unknown.body().props.adjustments.meta.total, 2)
  })

  test('pieces an inventory found never show as a negative sold count (PRO-19)', async ({
    client,
    assert,
  }) => {
    const { supplier, delivery } = await setup({ amount: 10, price: 5 })
    // What a surplus on an untouched lot leaves behind.
    await db
      .from('deliveries')
      .where('id', delivery.id)
      .update({ amount_left: 11, amount_lost: -1 })

    const response = await client.get('/supplier/deliveries').loginAs(supplier).headers(inertia)
    const [row] = response.body().props.recentDeliveries.data
    assert.equal(row.soldCount, 0)
    assert.equal(row.lostCount, -1)
  })

  test('DELETE of a lot with a write-off explains why it cannot be voided (BE-15)', async ({
    client,
    assert,
  }) => {
    const { supplier, product, delivery } = await setup({ amount: 10, price: 5 })
    await new InventoryService().writeOff(supplier, {
      productId: product.id,
      quantity: 1,
      reason: 'damaged',
    })

    const response = await client
      .delete(`/supplier/deliveries/${delivery.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ reason: 'Stocked twice' })
      .redirects(0)

    response.assertStatus(302)
    response.assertFlashMessage('alert', {
      type: 'danger',
      message:
        'Z dodávky už je něco odepsané nebo ji upravila inventura, proto ji nelze stornovat. Snižte množství přes Opravit.',
    })
    const row = await db.from('deliveries').where('id', delivery.id).first()
    assert.isNull(row.voided_at)
  })

  test('ids beyond the integer column are a 404 or an ignored filter, never a 500', async ({
    client,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const huge = '99999999999'

    for (const url of [
      `/supplier/stock/drafts/${huge}`,
      `/supplier/inventory/${huge}`,
      `/supplier/products/${huge}/edit`,
    ]) {
      const response = await client.get(url).loginAs(supplier).redirects(0)
      response.assertStatus(404)
    }
    const put = await client
      .put(`/supplier/deliveries/${huge}`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ amount: 1, price: 1, reason: 'Typo' })
      .redirects(0)
    put.assertStatus(404)

    for (const url of [
      `/supplier/stock?categoryId=${huge}`,
      `/supplier/deliveries?productId=${huge}`,
      `/supplier/deliveries?type=adjustments&productId=${huge}`,
    ]) {
      const response = await client.get(url).loginAs(supplier).headers(inertia)
      response.assertStatus(200)
    }
  })
})

test.group('Web Supplier - change the price of the remaining stock', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(async () => {
    await settleSideEffects()
    await cleanAll()
  })

  const reprice = (
    client: ApiClient,
    user: User,
    items: Array<{ deliveryId: number; price: number }>
  ) =>
    client
      .post('/supplier/stock/reprice')
      .loginAs(user)
      .withCsrfToken()
      .header('referer', '/supplier/stock?stockState=low&page=2')
      .json({ items })
      .redirects(0)

  test('POST /supplier/stock/reprice changes the chosen lots and keeps the filters', async ({
    client,
    assert,
  }) => {
    const { supplier, product, delivery } = await setup({ amount: 6, price: 20 })
    const second = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 3,
      amountLeft: 3,
      price: 20,
    }).create()
    const buyer = await UserFactory.create()
    await new OrderService().purchase(buyer.id, delivery.id, 'web')

    const response = await reprice(client, supplier, [{ deliveryId: delivery.id, price: 15 }])

    response.assertStatus(302)
    // Back to the filtered list it came from, query string and all.
    assert.equal(response.header('location'), '/supplier/stock?stockState=low&page=2')
    response.assertFlashMessage('alert', {
      type: 'success',
      message: 'Cena změněna u 1 dodávky (5 ks na skladě). Prodané kusy se nemění.',
    })
    const prices = await db.from('deliveries').orderBy('id').select('id', 'price')
    assert.deepEqual(
      prices.map((row) => [Number(row.id), Number(row.price)]),
      [
        [delivery.id, 15],
        [second.id, 20],
      ]
    )
    const [order] = await db.from('orders').where('delivery_id', delivery.id)
    assert.equal(Number(order.unit_price), 20)
    const log = await db.from('audit_logs').where('action', 'delivery.repriced').first()
    assert.equal(log.user_id, supplier.id)
  })

  test('the history shows the new price on the lot', async ({ client, assert }) => {
    const { supplier, product } = await setup({ amount: 6, price: 20 })
    await new DeliveryService().repriceRemaining(supplier, product.id, 15)

    const page = await client.get('/supplier/deliveries').loginAs(supplier).headers(inertia)
    const [row] = page.body().props.recentDeliveries.data
    assert.equal(row.price, 15)
    assert.include(row.lastCorrection, { kind: 'reprice', oldPrice: 20, newPrice: 15 })
  })

  test('invalid input is a validation error and changes nothing', async ({ client, assert }) => {
    const { supplier, delivery } = await setup({ amount: 6, price: 20 })

    for (const items of [
      [{ deliveryId: delivery.id, price: 0 }],
      [{ deliveryId: delivery.id, price: 2.5 }],
      [{ deliveryId: delivery.id, price: 100_001 }],
      [],
      [
        { deliveryId: delivery.id, price: 15 },
        { deliveryId: delivery.id, price: 16 },
      ],
    ]) {
      const invalid = await client
        .post('/supplier/stock/reprice')
        .headers(inertia)
        .header('referer', '/supplier/stock')
        .loginAs(supplier)
        .withCsrfToken()
        .json({ items })
        .redirects(1)
      assert.isNotEmpty(invalid.body().props.errors, JSON.stringify(items))
    }
    const row = await db.from('deliveries').where('id', delivery.id).first()
    assert.equal(Number(row.price), 20)
  })

  test("a supplier cannot reprice a colleague's lot (IDOR); an admin can", async ({
    client,
    assert,
  }) => {
    const { supplier, delivery } = await setup({ amount: 6, price: 20 })
    const colleague = await UserFactory.apply('supplier').create()

    const refused = await reprice(client, colleague, [{ deliveryId: delivery.id, price: 15 }])
    refused.assertFlashMessage('alert', {
      type: 'danger',
      message: 'Cenu cizí dodávky může změnit jen administrátor.',
    })
    const unchanged = await db.from('deliveries').where('id', delivery.id).first()
    assert.equal(Number(unchanged.price), 20)

    const admin = await UserFactory.apply('admin').create()
    const done = await reprice(client, admin, [{ deliveryId: delivery.id, price: 15 }])
    done.assertFlashMessage('alert', {
      type: 'success',
      message: 'Cena změněna u 1 dodávky (6 ks na skladě). Prodané kusy se nemění.',
    })
    const log = await db.from('audit_logs').where('action', 'delivery.repriced').first()
    assert.equal(log.target_user_id, supplier.id)
  })

  test('a customer can neither reprice nor list the lots', async ({ client, assert }) => {
    const { product, delivery } = await setup({ amount: 6, price: 20 })
    const customer = await UserFactory.create()

    const response = await reprice(client, customer, [{ deliveryId: delivery.id, price: 15 }])
    response.assertStatus(302)
    assert.equal(response.header('location'), '/')
    const lots = await client
      .get(`/supplier/stock/products/${product.id}/lots`)
      .loginAs(customer)
      .redirects(0)
    lots.assertStatus(302)
    const row = await db.from('deliveries').where('id', delivery.id).first()
    assert.equal(Number(row.price), 20)
  })

  test('the dialog data lists lots in FIFO order without purchase prices', async ({
    client,
    assert,
  }) => {
    const { supplier, product, delivery } = await setup({
      amount: 4,
      price: 20,
      purchasePrice: 9.9,
    })
    const colleague = await UserFactory.apply('supplier').create()
    const theirs = await DeliveryFactory.merge({
      supplierId: colleague.id,
      productId: product.id,
      amountSupplied: 3,
      amountLeft: 3,
      price: 22,
      purchasePrice: 7.5,
    }).create()

    const response = await client
      .get(`/supplier/stock/products/${product.id}/lots`)
      .loginAs(colleague)
      .header('accept', 'application/json')
    response.assertStatus(200)
    const { lots } = response.body()
    assert.deepEqual(
      lots.map((l: any) => [l.deliveryId, l.amountLeft, l.price, l.mine, l.editable]),
      [
        [delivery.id, 4, 20, false, false],
        [theirs.id, 3, 22, true, true],
      ]
    )
    assert.equal(lots[0].supplier.name, supplier.displayName)
    assert.notInclude(JSON.stringify(response.body()), '9.9')
    assert.notInclude(JSON.stringify(response.body()), 'purchase')
  })
})

test.group('Web Supplier - write-off says where the pieces really came from', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(async () => {
    await settleSideEffects()
    await cleanAll()
  })

  test('a preview that still holds is a plain success; a stale one is spelled out', async ({
    client,
    assert,
  }) => {
    const { supplier, product, delivery } = await setup({ amount: 2, price: 20 })
    const newer = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 5,
      amountLeft: 5,
      price: 20,
    }).create()

    const ok = await client
      .post('/supplier/stock/write-offs')
      .loginAs(supplier)
      .withCsrfToken()
      .json({
        productId: product.id,
        quantity: 1,
        reason: 'damaged',
        preview: [{ deliveryId: delivery.id, quantity: 1 }],
      })
      .redirects(0)
    ok.assertFlashMessage('alert', { type: 'success', message: 'Odepsáno 1 ks.' })

    // The dialog still thinks the old lot has 2 pieces; a sale took one meanwhile.
    const stale = await client
      .post('/supplier/stock/write-offs')
      .loginAs(supplier)
      .withCsrfToken()
      .json({
        productId: product.id,
        quantity: 2,
        reason: 'damaged',
        preview: [{ deliveryId: delivery.id, quantity: 2 }],
      })
      .redirects(0)
    const alert = stale.flashMessages().alert as { type: string; message: string }
    assert.equal(alert.type, 'warn')
    assert.include(alert.message, 'Odepsáno 2 ks')
    assert.include(alert.message, `${supplier.displayName} 1 ks`)
    const lots = await db.from('deliveries').orderBy('id').select('id', 'amount_left')
    assert.deepEqual(
      lots.map((row) => [Number(row.id), Number(row.amount_left)]),
      [
        [delivery.id, 0],
        [newer.id, 4],
      ]
    )
  })
})

test.group('Web Supplier - handed-over stock in the history', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('both sides see who handed over what, not an empty correction', async ({
    client,
    assert,
  }) => {
    const { supplier: leaving, product } = await setup({ amount: 5, price: 20 })
    const heir = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    await new DeliveryService().transferStock(leaving.id, heir.id, admin)

    const theirs = await client
      .get('/supplier/deliveries?scope=mine')
      .loginAs(leaving)
      .headers(inertia)
    const [out] = theirs.body().props.recentDeliveries.data
    assert.include(out.transfer, { direction: 'out', counterpart: heir.displayName, pieces: 5 })
    assert.isNull(out.lastCorrection)
    assert.equal(out.correctionCount, 0)

    const mine = await client
      .get(`/supplier/deliveries?productId=${product.id}&scope=mine`)
      .loginAs(heir)
      .headers(inertia)
    const [taken] = mine.body().props.recentDeliveries.data
    assert.include(taken.transfer, { direction: 'in', counterpart: leaving.displayName, pieces: 5 })
    assert.equal(taken.amountLeft, 5)
  })
})
