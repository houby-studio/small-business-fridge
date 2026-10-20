import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import { UserFactory } from '#database/factories/user_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { OrderFactory } from '#database/factories/order_factory'
import InvoiceService from '#services/invoice_service'
import Invoice from '#models/invoice'

const invoiceService = new InvoiceService()

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('orders').delete()
  await db.from('invoices').delete()
  await db.from('deliveries').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('users').delete()
}

async function issuedInvoice() {
  const supplier = await UserFactory.apply('supplier')
    .merge({ email: 'race-seller@example.com' })
    .create()
  const buyer = await UserFactory.merge({ email: 'race-buyer@example.com' }).create()
  const delivery = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
    .merge({ supplierId: supplier.id, amountSupplied: 3, amountLeft: 2, price: 20 })
    .create()
  await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id, unitPrice: 20 }).create()
  const invoice = (await invoiceService.generateInvoiceForBuyer(supplier.id, buyer.id))!
  return { supplier, buyer, invoice }
}

const audits = (action: string, invoiceId: number) =>
  db.from('audit_logs').where('action', action).where('entity_id', invoiceId)

/** E-mails leave after the commit; give both racers time to send theirs. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300))

test.group('InvoiceService - one payment change at a time', (group) => {
  let fake: ReturnType<typeof mail.fake>
  group.each.setup(async () => {
    await cleanAll()
    fake = mail.fake()
  })
  group.each.teardown(async () => {
    mail.restore()
    await cleanAll()
  })

  const sentTo = (address: string) =>
    fake.messages.sent().filter((message) => message.hasTo(address)).length

  test('a payment reported twice at once is recorded and announced once', async ({ assert }) => {
    const { buyer, invoice } = await issuedInvoice()
    await settle()

    await Promise.all([
      invoiceService.requestPayment(invoice.id, buyer.id),
      invoiceService.requestPayment(invoice.id, buyer.id),
    ])
    await settle()

    assert.lengthOf(await audits('payment.requested', invoice.id), 1)
    assert.equal(sentTo('race-seller@example.com'), 1)
  })

  test('a payment approved twice at once is recorded and announced once', async ({ assert }) => {
    const { supplier, buyer, invoice } = await issuedInvoice()
    await invoiceService.requestPayment(invoice.id, buyer.id)
    await settle()
    const buyerMailsBefore = sentTo('race-buyer@example.com')

    await Promise.all([
      invoiceService.approvePayment(invoice.id, supplier.id),
      invoiceService.approvePayment(invoice.id, supplier.id),
    ])
    await settle()

    assert.lengthOf(await audits('payment.approved', invoice.id), 1)
    assert.equal(sentTo('race-buyer@example.com') - buyerMailsBefore, 1)
    const paid = await Invoice.findOrFail(invoice.id)
    assert.isTrue(paid.isPaid)
  })

  test('a payment rejected twice at once is recorded and announced once', async ({ assert }) => {
    const { supplier, buyer, invoice } = await issuedInvoice()
    await invoiceService.requestPayment(invoice.id, buyer.id)
    await settle()
    const buyerMailsBefore = sentTo('race-buyer@example.com')

    await Promise.all([
      invoiceService.rejectPayment(invoice.id, supplier.id),
      invoiceService.rejectPayment(invoice.id, supplier.id),
    ])
    await settle()

    assert.lengthOf(await audits('payment.rejected', invoice.id), 1)
    assert.equal(sentTo('race-buyer@example.com') - buyerMailsBefore, 1)
  })
})
