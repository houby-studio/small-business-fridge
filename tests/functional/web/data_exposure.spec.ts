import '#tests/test_context'
import { test } from '@japa/runner'
import { readFileSync } from 'node:fs'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import OrderService from '#services/order_service'
import InvoiceService from '#services/invoice_service'
import DeliveryService from '#services/delivery_service'
import AuditService from '#services/audit_service'
import {
  CORRECTION_REASON_MAX_LENGTH,
  CORRECTION_REASON_MIN_LENGTH,
  DELIVERY_MAX_AMOUNT,
  DELIVERY_MAX_PRICE,
} from '#validators/delivery'
import db from '@adonisjs/lucid/services/db'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('orders').delete()
  await db.from('invoices').delete()
  await db.from('delivery_corrections').delete()
  await db.from('deliveries').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('users').delete()
}

const inertia = { 'X-Inertia': 'true', 'X-Inertia-Version': '1' }

async function purchaseSetup() {
  const supplier = await UserFactory.apply('supplier').apply('withIban').create()
  const buyer = await UserFactory.apply('withIban').create()
  const category = await CategoryFactory.create()
  const product = await ProductFactory.merge({ categoryId: category.id }).create()
  const delivery = await DeliveryFactory.merge({
    supplierId: supplier.id,
    productId: product.id,
    amountSupplied: 5,
    amountLeft: 5,
    price: 10,
  }).create()
  await new OrderService().purchase(buyer.id, delivery.id, 'web')
  return { supplier, buyer, delivery }
}

/** Another user's record in page props may carry only their id and display name. */
function assertPublicOnly(assert: any, user: Record<string, unknown>) {
  assert.sameMembers(Object.keys(user), ['id', 'displayName'])
}

test.group('Other users are exposed by name only', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test("a buyer's orders page carries only the supplier's name", async ({ client, assert }) => {
    const { buyer } = await purchaseSetup()

    const response = await client.get('/orders').loginAs(buyer).headers(inertia)
    response.assertStatus(200)
    const order = response.body().props.orders.data[0]
    assertPublicOnly(assert, order.delivery.supplier)
    assert.notInclude(response.text(), 'CZ65')
  })

  test("a buyer's invoices page carries only the supplier's name", async ({ client, assert }) => {
    const { supplier, buyer } = await purchaseSetup()
    await new InvoiceService().generateInvoiceForBuyer(supplier.id, buyer.id)

    const response = await client.get('/invoices').loginAs(buyer).headers(inertia)
    response.assertStatus(200)
    assertPublicOnly(assert, response.body().props.invoices.data[0].supplier)
  })

  test("a supplier's payments page carries only the buyer's name", async ({ client, assert }) => {
    const { supplier, buyer } = await purchaseSetup()
    await new InvoiceService().generateInvoiceForBuyer(supplier.id, buyer.id)

    const response = await client.get('/supplier/payments').loginAs(supplier).headers(inertia)
    response.assertStatus(200)
    assertPublicOnly(assert, response.body().props.invoices.data[0].buyer)
  })

  test('a repriced order exposes only the reason and date of the correction', async ({
    client,
    assert,
  }) => {
    const { supplier, buyer, delivery } = await purchaseSetup()
    await new DeliveryService().correctDelivery(supplier, delivery.id, {
      amount: 5,
      price: 12,
      reason: 'Typo',
    })

    const response = await client.get('/orders').loginAs(buyer).headers(inertia)
    const correction = response.body().props.orders.data[0].priceCorrection
    assert.sameMembers(Object.keys(correction), ['id', 'reason', 'createdAt'])
  })
})

test.group('Impersonation marker stays with the impersonated user', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a third party listed on the entry does not see the impersonation', async ({
    client,
    assert,
  }) => {
    const customer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    // An order the admin placed while impersonating the customer, on the supplier's stock.
    await AuditService.log(customer.id, 'order.created', 'order', 1, supplier.id, {
      price: 10,
      impersonatedBy: { id: admin.id, name: admin.displayName },
    })

    const own = await client.get('/audit').loginAs(customer).headers(inertia)
    assert.equal(own.body().props.logs.data[0].impersonatedBy, admin.displayName)

    const third = await client.get('/audit').loginAs(supplier).headers(inertia)
    const row = third.body().props.logs.data[0]
    assert.isNull(row.impersonatedBy)
    assert.notProperty(row.metadata, 'impersonatedBy')
  })
})

test.group('Delivery amount and price limits', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a correction above the price cap is rejected', async ({ client, assert }) => {
    const { supplier, delivery } = await purchaseSetup()

    await client
      .put(`/supplier/deliveries/${delivery.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ amount: 5, price: DELIVERY_MAX_PRICE + 1, reason: 'Too much' })
      .redirects(0)

    await delivery.refresh()
    assert.equal(delivery.price, 10)
  })

  test('stocking a fractional amount or price is rejected', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()

    await client
      .post('/supplier/deliveries')
      .loginAs(supplier)
      .withCsrfToken()
      .json({ productId: product.id, amount: 2.5, price: 10, confirmWarnings: true })
      .redirects(0)
    await client
      .post('/supplier/deliveries')
      .loginAs(supplier)
      .withCsrfToken()
      .json({ productId: product.id, amount: 2, price: 9.5, confirmWarnings: true })
      .redirects(0)

    assert.lengthOf(await db.from('deliveries').where('product_id', product.id), 0)
  })

  test('the frontend validation mirror uses the same limits as the backend', ({ assert }) => {
    // AGENTS.md: the client-side mirror must match the VineJS validator exactly.
    const source = readFileSync(
      'inertia/composables/use_delivery_correction_validation.ts',
      'utf-8'
    )
    const constant = (name: string) =>
      Number(new RegExp(`${name} = ([\\d_]+)`).exec(source)?.[1].replaceAll('_', ''))

    assert.equal(constant('CORRECTION_REASON_MIN_LENGTH'), CORRECTION_REASON_MIN_LENGTH)
    assert.equal(constant('CORRECTION_REASON_MAX_LENGTH'), CORRECTION_REASON_MAX_LENGTH)
    assert.equal(constant('DELIVERY_MAX_PRICE'), DELIVERY_MAX_PRICE)
    assert.equal(constant('DELIVERY_MAX_AMOUNT'), DELIVERY_MAX_AMOUNT)
  })
})
