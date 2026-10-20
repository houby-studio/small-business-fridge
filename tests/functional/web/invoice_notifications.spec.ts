import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import type { FakeMailer } from '@adonisjs/mail'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { OrderFactory } from '#database/factories/order_factory'
import Invoice from '#models/invoice'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('orders').delete()
  await db.from('invoices').delete()
  await db.from('deliveries').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('users').delete()
}

/** E-mails are sent after the response; wait until `count` reached `address`, or fail. */
async function mailsTo(fake: FakeMailer, address: string, count: number): Promise<number> {
  const sentTo = () => fake.messages.sent().filter((m) => m.hasTo(address)).length
  const started = Date.now()
  while (sentTo() < count) {
    if (Date.now() - started > 3000) {
      throw new Error(`timed out waiting for ${count} e-mail(s) to ${address}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  // A duplicate would arrive right after the first one — give it the chance to show up.
  await new Promise((resolve) => setTimeout(resolve, 150))
  return sentTo()
}

async function soldToBuyer() {
  const supplier = await UserFactory.apply('supplier')
    .merge({ email: 'seller@example.com' })
    .create()
  const buyer = await UserFactory.merge({ email: 'buyer@example.com' }).create()
  const category = await CategoryFactory.create()
  const product = await ProductFactory.merge({ categoryId: category.id }).create()
  const delivery = await DeliveryFactory.merge({
    supplierId: supplier.id,
    productId: product.id,
    amountSupplied: 5,
    amountLeft: 4,
    price: 20,
  }).create()
  await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id, unitPrice: 20 }).create()
  return { supplier, buyer, delivery }
}

/**
 * The services send the invoice and payment e-mails now (so MCP sends them too); the web
 * controllers must not send them a second time.
 */
test.group('Web invoicing and payments e-mail exactly once', (group) => {
  let fake: FakeMailer
  group.each.setup(async () => {
    await cleanAll()
    fake = mail.fake()
  })
  group.each.teardown(async () => {
    mail.restore()
    await cleanAll()
  })

  test('generating invoices e-mails the buyer once and the self-invoice nobody', async ({
    client,
    assert,
  }) => {
    const { supplier, delivery } = await soldToBuyer()
    await OrderFactory.merge({
      buyerId: supplier.id,
      deliveryId: delivery.id,
      unitPrice: 20,
    }).create()

    const response = await client
      .post('/supplier/invoice/generate')
      .loginAs(supplier)
      .withCsrfToken()
      .redirects(0)
    response.assertStatus(302)

    assert.equal(await mailsTo(fake, 'buyer@example.com', 1), 1)
    assert.equal(fake.messages.sent().filter((m) => m.hasTo('seller@example.com')).length, 0)
    assert.lengthOf(await Invoice.all(), 2)
  })

  test('reporting, approving and rejecting a payment e-mail once each', async ({
    client,
    assert,
  }) => {
    const { supplier, buyer } = await soldToBuyer()
    await client.post('/supplier/invoice/generate').loginAs(supplier).withCsrfToken()
    await mailsTo(fake, 'buyer@example.com', 1)
    const invoice = await Invoice.findByOrFail('buyerId', buyer.id)

    await client.post(`/invoices/${invoice.id}/request-paid`).loginAs(buyer).withCsrfToken()
    await mailsTo(fake, 'seller@example.com', 1)

    await client
      .post(`/supplier/payments/${invoice.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ action: 'reject' })
    await mailsTo(fake, 'buyer@example.com', 2)

    await client.post(`/invoices/${invoice.id}/request-paid`).loginAs(buyer).withCsrfToken()
    await mailsTo(fake, 'seller@example.com', 2)
    await client
      .post(`/supplier/payments/${invoice.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ action: 'approve' })
    // invoice, rejected, approved — and no second copy of any of them
    assert.equal(await mailsTo(fake, 'buyer@example.com', 3), 3)
    assert.equal(fake.messages.sent().filter((m) => m.hasTo('seller@example.com')).length, 2)
  })

  test('an admin storno e-mails the buyer and the supplier once', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const { delivery } = await soldToBuyer()
    const order = await db.from('orders').where('delivery_id', delivery.id).firstOrFail()

    const response = await client
      .post(`/admin/storno/${order.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
    response.assertStatus(302)

    assert.equal(await mailsTo(fake, 'buyer@example.com', 1), 1)
    assert.equal(await mailsTo(fake, 'seller@example.com', 1), 1)
    await delivery.refresh()
    assert.equal(delivery.amountLeft, 5)
  })
})
