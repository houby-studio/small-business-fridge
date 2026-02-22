import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'
import type { FakeMailer } from '@adonisjs/mail'
import { DateTime } from 'luxon'
import { UserFactory } from '#database/factories/user_factory'
import { InvoiceFactory } from '#database/factories/invoice_factory'
import NotificationService from '#services/notification_service'
import db from '@adonisjs/lucid/services/db'

const notificationService = new NotificationService()

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('orders').delete()
  await db.from('invoices').delete()
  await db.from('deliveries').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('auth_access_tokens').delete()
  await db.from('users').delete()
}

test.group('NotificationService - sendUnpaidInvoiceReminders', (group) => {
  let fakeMailer: FakeMailer

  group.each.setup(async () => {
    await cleanAll()
    fakeMailer = mail.fake()
  })
  group.each.teardown(async () => {
    mail.restore()
    await cleanAll()
  })

  test('sends reminder for invoice older than 3 days', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()

    await InvoiceFactory.merge({
      buyerId: buyer.id,
      supplierId: supplier.id,
      createdAt: DateTime.now().minus({ days: 4 }),
    }).create()

    await notificationService.sendUnpaidInvoiceReminders()

    assert.isAbove(fakeMailer.messages.sent().length, 0)
    fakeMailer.messages.assertSent((msg) => msg.hasTo(buyer.email))
  })

  test('skips invoice newer than 3 days', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()

    await InvoiceFactory.merge({
      buyerId: buyer.id,
      supplierId: supplier.id,
      createdAt: DateTime.now().minus({ days: 1 }),
    }).create()

    await notificationService.sendUnpaidInvoiceReminders()

    assert.equal(fakeMailer.messages.sent().length, 0)
  })

  test('skips invoice where payment is already requested', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()

    await InvoiceFactory.apply('paymentRequested')
      .merge({
        buyerId: buyer.id,
        supplierId: supplier.id,
        createdAt: DateTime.now().minus({ days: 5 }),
      })
      .create()

    await notificationService.sendUnpaidInvoiceReminders()

    assert.equal(fakeMailer.messages.sent().length, 0)
  })

  test('skips paid invoice', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()

    await InvoiceFactory.apply('paid')
      .merge({
        buyerId: buyer.id,
        supplierId: supplier.id,
        createdAt: DateTime.now().minus({ days: 5 }),
      })
      .create()

    await notificationService.sendUnpaidInvoiceReminders()

    assert.equal(fakeMailer.messages.sent().length, 0)
  })

  test('skips invoice for disabled buyer', async ({ assert }) => {
    const buyer = await UserFactory.apply('disabled').create()
    const supplier = await UserFactory.apply('supplier').create()

    await InvoiceFactory.merge({
      buyerId: buyer.id,
      supplierId: supplier.id,
      createdAt: DateTime.now().minus({ days: 5 }),
    }).create()

    await notificationService.sendUnpaidInvoiceReminders()

    assert.equal(fakeMailer.messages.sent().length, 0)
  })

  test('increments autoReminderCount after sending', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()

    const invoice = await InvoiceFactory.merge({
      buyerId: buyer.id,
      supplierId: supplier.id,
      autoReminderCount: 0,
      createdAt: DateTime.now().minus({ days: 4 }),
    }).create()

    await notificationService.sendUnpaidInvoiceReminders()

    await invoice.refresh()
    assert.equal(invoice.autoReminderCount, 1)
  })

  test('sends to multiple buyers with old invoices', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer1 = await UserFactory.create()
    const buyer2 = await UserFactory.create()

    await InvoiceFactory.merge({
      buyerId: buyer1.id,
      supplierId: supplier.id,
      createdAt: DateTime.now().minus({ days: 5 }),
    }).create()
    await InvoiceFactory.merge({
      buyerId: buyer2.id,
      supplierId: supplier.id,
      createdAt: DateTime.now().minus({ days: 5 }),
    }).create()

    await notificationService.sendUnpaidInvoiceReminders()

    assert.equal(fakeMailer.messages.sent().length, 2)
  })
})

test.group('NotificationService - sendPendingApprovalReminders', (group) => {
  let fakeMailer: FakeMailer

  group.each.setup(async () => {
    await cleanAll()
    fakeMailer = mail.fake()
  })
  group.each.teardown(async () => {
    mail.restore()
    await cleanAll()
  })

  test('sends reminder to supplier with pending invoices', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()

    await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    await notificationService.sendPendingApprovalReminders()

    assert.equal(fakeMailer.messages.sent().length, 1)
    fakeMailer.messages.assertSent((msg) => msg.hasTo(supplier.email))
  })

  test('groups multiple pending invoices into one email per supplier', async ({ assert }) => {
    const buyer1 = await UserFactory.create()
    const buyer2 = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()

    await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer1.id, supplierId: supplier.id })
      .create()
    await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer2.id, supplierId: supplier.id })
      .create()

    await notificationService.sendPendingApprovalReminders()

    // One email to the supplier covering both invoices
    assert.equal(fakeMailer.messages.sent().length, 1)
  })

  test('sends separate emails to different suppliers', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier1 = await UserFactory.apply('supplier').create()
    const supplier2 = await UserFactory.apply('supplier').create()

    await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier1.id })
      .create()
    await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier2.id })
      .create()

    await notificationService.sendPendingApprovalReminders()

    assert.equal(fakeMailer.messages.sent().length, 2)
  })

  test('skips disabled supplier', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').apply('disabled').create()

    await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    await notificationService.sendPendingApprovalReminders()

    assert.equal(fakeMailer.messages.sent().length, 0)
  })

  test('skips already-paid invoices', async ({ assert }) => {
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()

    await InvoiceFactory.apply('paid')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    await notificationService.sendPendingApprovalReminders()

    assert.equal(fakeMailer.messages.sent().length, 0)
  })

  test('sends nothing when no pending invoices exist', async ({ assert }) => {
    await notificationService.sendPendingApprovalReminders()
    assert.equal(fakeMailer.messages.sent().length, 0)
  })
})
