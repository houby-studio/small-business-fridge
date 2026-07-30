/**
 * Real SMTP delivery tests — these do NOT use mail.fake().
 * Emails flow through to Mailpit and are verified via its REST API.
 *
 * Tests self-skip when MAILPIT_API_URL is unset (e.g. local dev without Docker).
 * In CI, Mailpit is always available as a service.
 */

import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { UserFactory } from '#database/factories/user_factory'
import { InvoiceFactory } from '#database/factories/invoice_factory'
import { OrderFactory } from '#database/factories/order_factory'
import NotificationService from '#services/notification_service'
import {
  isMailpitAvailable,
  clearAll,
  waitForMessageTo,
  getMessage,
  getHtmlCheck,
} from '#tests/utils/mailpit'

const notificationService = new NotificationService()

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('orders').delete()
  await db.from('invoices').delete()
  await db.from('deliveries').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('users').delete()
}

// ─── Invitation email ─────────────────────────────────────────────────────────

test.group('Mail Delivery - registration invite', (group) => {
  group.each.setup(async () => {
    await cleanAll()
    if (isMailpitAvailable()) await clearAll()
  })
  group.each.teardown(async () => {
    await cleanAll()
    if (isMailpitAvailable()) await clearAll()
  })

  test('invitation email arrives at the invited address', async ({ assert }) => {
    if (!isMailpitAvailable()) return

    await notificationService.sendRegistrationInvite({
      email: 'new-member@mailtest.local',
      inviteUrl: 'http://localhost:3334/register/invite/sbfv2.42.abc123',
      role: 'customer',
      expiresAt: DateTime.now().plus({ days: 7 }),
    })

    const summary = await waitForMessageTo('new-member@mailtest.local')
    assert.isNotNull(summary, 'Expected invitation email to arrive in Mailpit')

    assert.include(summary!.Subject, 'Pozvánka', 'Subject should contain Czech invite word')
    assert.equal(
      summary!.To[0].Address,
      'new-member@mailtest.local',
      'To address should match invitee'
    )
  })

  test('invitation email body contains the invite URL', async ({ assert }) => {
    if (!isMailpitAvailable()) return

    const inviteUrl = 'http://localhost:3334/register/invite/sbfv2.99.xyzcheck'

    await notificationService.sendRegistrationInvite({
      email: 'body-check@mailtest.local',
      inviteUrl,
      role: 'supplier',
      expiresAt: DateTime.now().plus({ days: 3 }),
    })

    const summary = await waitForMessageTo('body-check@mailtest.local')
    assert.isNotNull(summary, 'Expected invitation email to arrive in Mailpit')

    const message = await getMessage(summary!.ID)
    assert.include(
      message.HTML,
      inviteUrl,
      'HTML body should contain the full registration invite URL'
    )
  })

  test('invitation email HTML is broadly compatible across email clients', async ({ assert }) => {
    if (!isMailpitAvailable()) return

    await notificationService.sendRegistrationInvite({
      email: 'html-check@mailtest.local',
      inviteUrl: 'http://localhost:3334/register/invite/sbfv2.1.htmlcheck',
      role: 'customer',
      expiresAt: DateTime.now().plus({ days: 7 }),
    })

    const summary = await waitForMessageTo('html-check@mailtest.local')
    assert.isNotNull(summary, 'Expected invitation email to arrive in Mailpit')

    const check = await getHtmlCheck(summary!.ID)

    // Fail if more than 30 % of checked CSS/HTML features are unsupported.
    // Total.Unsupported is already a percentage (0–100); our simple inline-CSS
    // templates typically score well under 10 %.
    const unsupportedPct = check.Total.Unsupported
    assert.isBelow(
      unsupportedPct,
      30,
      `Too many unsupported features (${unsupportedPct.toFixed(1)} %). ` +
        `Unsupported: ${check.Warnings.filter((w) => w.Score.Unsupported > 0)
          .map((w) => w.Title)
          .join(', ')}`
    )
  })
})

// ─── Invoice notice ───────────────────────────────────────────────────────────

test.group('Mail Delivery - invoice notice', (group) => {
  group.each.setup(async () => {
    await cleanAll()
    if (isMailpitAvailable()) await clearAll()
  })
  group.each.teardown(async () => {
    await cleanAll()
    if (isMailpitAvailable()) await clearAll()
  })

  test('invoice notice email arrives at the buyer', async ({ assert }) => {
    if (!isMailpitAvailable()) return

    const buyer = await UserFactory.merge({ email: 'invoice-buyer@mailtest.local' }).create()
    const supplier = await UserFactory.apply('supplier').create()

    const invoice = await InvoiceFactory.merge({
      buyerId: buyer.id,
      supplierId: supplier.id,
    }).create()

    await OrderFactory.with('delivery', 1, (d) =>
      d.merge({ supplierId: supplier.id }).with('product', 1, (p) => p.with('category'))
    )
      .merge({ buyerId: buyer.id, invoiceId: invoice.id })
      .create()

    await notificationService.sendInvoiceNotice(invoice)

    const summary = await waitForMessageTo('invoice-buyer@mailtest.local')
    assert.isNotNull(summary, 'Expected invoice notice email to arrive in Mailpit')
    assert.include(summary!.Subject, 'Faktura', 'Subject should contain "Faktura"')
    assert.equal(summary!.To[0].Address, 'invoice-buyer@mailtest.local')
  })
})

// ─── Unpaid reminder ──────────────────────────────────────────────────────────

test.group('Mail Delivery - unpaid invoice reminder', (group) => {
  group.each.setup(async () => {
    await cleanAll()
    if (isMailpitAvailable()) await clearAll()
  })
  group.each.teardown(async () => {
    await cleanAll()
    if (isMailpitAvailable()) await clearAll()
  })

  test('unpaid reminder email arrives at the buyer', async ({ assert }) => {
    if (!isMailpitAvailable()) return

    const buyer = await UserFactory.merge({ email: 'reminder-buyer@mailtest.local' }).create()
    const supplier = await UserFactory.apply('supplier').create()

    await InvoiceFactory.merge({
      buyerId: buyer.id,
      supplierId: supplier.id,
      createdAt: DateTime.now().minus({ days: 5 }),
    }).create()

    await notificationService.sendUnpaidInvoiceReminders()

    const summary = await waitForMessageTo('reminder-buyer@mailtest.local')
    assert.isNotNull(summary, 'Expected unpaid reminder email to arrive in Mailpit')
    assert.include(summary!.Subject, 'Připomínka', 'Subject should contain Czech reminder word')
    assert.equal(summary!.To[0].Address, 'reminder-buyer@mailtest.local')
  })

  test('unpaid reminder email body contains a link back to the app', async ({ assert }) => {
    if (!isMailpitAvailable()) return

    const buyer = await UserFactory.merge({ email: 'reminder-link@mailtest.local' }).create()
    const supplier = await UserFactory.apply('supplier').create()

    await InvoiceFactory.merge({
      buyerId: buyer.id,
      supplierId: supplier.id,
      createdAt: DateTime.now().minus({ days: 5 }),
    }).create()

    await notificationService.sendUnpaidInvoiceReminders()

    const summary = await waitForMessageTo('reminder-link@mailtest.local')
    assert.isNotNull(summary)

    const message = await getMessage(summary!.ID)
    assert.include(
      message.HTML,
      'localhost:3334',
      'HTML body should contain the app URL for invoices link'
    )
  })
})
