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
import NotificationService from '#services/notification_service'
import DeliveryCorrection from '#models/delivery_correction'
import db from '@adonisjs/lucid/services/db'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('user_favorites').delete()
  await db.from('orders').delete()
  await db.from('invoices').delete()
  await db.from('delivery_corrections').delete()
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

async function setup(options: { amount?: number; price?: number } = {}) {
  const supplier = await UserFactory.apply('supplier').create()
  const category = await CategoryFactory.create()
  const product = await ProductFactory.merge({ categoryId: category.id }).create()
  const delivery = await DeliveryFactory.merge({
    supplierId: supplier.id,
    productId: product.id,
    amountSupplied: options.amount ?? 10,
    amountLeft: options.amount ?? 10,
    price: options.price ?? 1,
  }).create()
  return { supplier, product, delivery }
}

test.group('Web Supplier - delivery warnings', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a repeated delivery is not stocked until the warning is confirmed', async ({
    client,
    assert,
  }) => {
    const { supplier, product } = await setup({ amount: 12, price: 25 })

    const warned = await client
      .post('/supplier/deliveries')
      .header('x-inertia', 'true')
      .header('x-inertia-version', '1')
      .header('referer', 'http://localhost/supplier/stock')
      .loginAs(supplier)
      .withCsrfToken()
      .json({ productId: product.id, amount: 12, price: 25 })
      .redirects(1)

    warned.assertStatus(200)
    const warning = warned.body().props.flash.deliveryWarning
    assert.exists(warning)
    assert.equal(warning.duplicate.amount, 12)
    assert.equal(warning.productId, product.id)
    assert.lengthOf(await db.from('deliveries').where('product_id', product.id), 1)

    const confirmed = await client
      .post('/supplier/deliveries')
      .loginAs(supplier)
      .withCsrfToken()
      .json({ productId: product.id, amount: 12, price: 25, confirmWarnings: true })
      .redirects(0)

    confirmed.assertStatus(302)
    assert.lengthOf(await db.from('deliveries').where('product_id', product.id), 2)
  })

  test('an unusual price is flagged before stocking', async ({ client, assert }) => {
    const { product } = await setup({ amount: 12, price: 25 })
    const other = await UserFactory.apply('supplier').create()

    const warned = await client
      .post('/supplier/deliveries')
      .header('x-inertia', 'true')
      .header('x-inertia-version', '1')
      .header('referer', 'http://localhost/supplier/stock')
      .loginAs(other)
      .withCsrfToken()
      .json({ productId: product.id, amount: 12, price: 250 })
      .redirects(1)

    const warning = warned.body().props.flash.deliveryWarning
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

      // The controller sends fire-and-forget; call it directly to assert deterministically.
      await new NotificationService().sendPriceCorrectionNotifications(correction.id)
      fakeMailer.messages.assertSent((message) => message.hasTo(buyer.email))
      assertFullyTranslated(assert, fakeMailer.messages.sent())
    } finally {
      mail.restore()
    }
  })

  test('PUT rejects an amount below the sold count', async ({ client, assert }) => {
    const { supplier, delivery } = await setup({ amount: 5, price: 10 })
    const buyer = await UserFactory.create()
    await new OrderService().purchase(buyer.id, delivery.id, 'web')
    await new OrderService().purchase(buyer.id, delivery.id, 'web')

    const response = await client
      .put(`/supplier/deliveries/${delivery.id}`)
      .header('x-inertia', 'true')
      .header('x-inertia-version', '1')
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
      .header('x-inertia', 'true')
      .header('x-inertia-version', '1')
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

  test('store scope lists other suppliers without letting them be corrected', async ({
    client,
    assert,
  }) => {
    const { delivery } = await setup({ amount: 10, price: 5 })
    const other = await UserFactory.apply('supplier').create()

    const mine = await client
      .get('/supplier/deliveries')
      .loginAs(other)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')
    assert.lengthOf(mine.body().props.recentDeliveries.data, 0)

    const store = await client
      .get('/supplier/deliveries?scope=store')
      .loginAs(other)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')
    const row = store.body().props.recentDeliveries.data[0]
    assert.equal(row.id, delivery.id)
    assert.isFalse(row.canCorrect)
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
      const notifications = new NotificationService()

      const own = await service.correctDelivery(supplier, delivery.id, {
        amount: 9,
        price: 1,
        reason: 'Own fix',
      })
      await notifications.sendDeliveryCorrectionToSupplier(own.correction.id)
      assert.lengthOf(fakeMailer.messages.sent(), 0)

      const foreign = await service.correctDelivery(admin, delivery.id, {
        amount: 9,
        price: 25,
        reason: 'Admin fixed the price',
      })
      await notifications.sendDeliveryCorrectionToSupplier(foreign.correction.id)
      fakeMailer.messages.assertSent((message) => message.hasTo(supplier.email))

      const voided = await setup({ amount: 4, price: 10 })
      const { correction } = await service.voidDelivery(admin, voided.delivery.id, 'Duplicate')
      await notifications.sendDeliveryCorrectionToSupplier(correction.id)
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
