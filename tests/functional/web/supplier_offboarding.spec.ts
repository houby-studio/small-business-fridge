import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { OrderFactory } from '#database/factories/order_factory'
import { InvoiceFactory } from '#database/factories/invoice_factory'
import type User from '#models/user'
import Invoice from '#models/invoice'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('stock_adjustments').delete()
  await db.from('delivery_corrections').delete()
  await db.from('orders').delete()
  await db.from('invoices').delete()
  await db.from('deliveries').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('auth_access_tokens').delete()
  await db.from('remember_me_tokens').delete()
  await db.from('users').delete()
}

async function supplierWithLot(left: number, sold: number) {
  const supplier = await UserFactory.apply('supplier').create()
  const category = await CategoryFactory.create()
  const product = await ProductFactory.merge({ categoryId: category.id }).create()
  const lot = await DeliveryFactory.merge({
    supplierId: supplier.id,
    productId: product.id,
    amountSupplied: left + sold,
    amountLeft: left,
    price: 20,
  }).create()
  const buyer = await UserFactory.create()
  for (let i = 0; i < sold; i++) {
    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: lot.id, unitPrice: 20 }).create()
  }
  return { supplier, product, lot, buyer }
}

/** The flash alert a redirect carried. */
function alertOf(response: { flashMessages(): unknown }) {
  const flash = response.flashMessages() as { alert?: { type: string; message: string } } | null
  return flash?.alert
}

async function put(client: any, admin: User, user: User, form: Record<string, string>) {
  return client
    .put(`/admin/users/${user.id}`)
    .loginAs(admin)
    .withCsrfToken()
    .form(form)
    .redirects(0)
}

test.group('Admin - a supplier leaves safely', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('stock on the shelf blocks disabling and the flash says how much', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const { supplier } = await supplierWithLot(4, 0)

    const response = await put(client, admin, supplier, { isDisabled: 'true' })
    response.assertStatus(302)
    const flash = alertOf(response)!
    assert.equal(flash.type, 'danger')
    assert.include(flash.message, '4')
    await supplier.refresh()
    assert.isFalse(supplier.isDisabled)
  })

  test('uninvoiced sales block demoting the supplier to a customer', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const { supplier } = await supplierWithLot(0, 2)

    await put(client, admin, supplier, { role: 'customer' })
    await supplier.refresh()
    assert.equal(supplier.role, 'supplier')

    // Promoting to admin keeps the supplier access — not blocked.
    await put(client, admin, supplier, { role: 'admin' })
    await supplier.refresh()
    assert.equal(supplier.role, 'admin')
  })

  test('unpaid invoices the supplier issued do not block disabling', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const { supplier, buyer } = await supplierWithLot(0, 1)
    await db.from('orders').update({ invoice_id: null })
    const invoice = await InvoiceFactory.merge({
      supplierId: supplier.id,
      buyerId: buyer.id,
    }).create()
    await db.from('orders').update({ invoice_id: invoice.id })

    await put(client, admin, supplier, { isDisabled: 'true' })
    await supplier.refresh()
    assert.isTrue(supplier.isDisabled)
  })

  test('handing the stock over keeps FIFO and the invariants, then the supplier can go', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const { supplier, lot, product } = await supplierWithLot(3, 0)
    const colleague = await UserFactory.apply('supplier').create()

    const page = await client
      .get('/admin/users')
      .loginAs(admin)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')
    const row = page.body().props.users.data.find((u: any) => u.id === supplier.id)
    assert.deepEqual(row.openBusiness, { lotsWithStock: 1, piecesLeft: 3, uninvoicedOrders: 0 })
    assert.include(
      page.body().props.supplierOptions.map((u: any) => u.id),
      colleague.id
    )

    const response = await client
      .post(`/admin/users/${supplier.id}/transfer-stock`)
      .loginAs(admin)
      .withCsrfToken()
      .json({ toUserId: colleague.id })
      .redirects(0)
    response.assertStatus(302)
    assert.equal(alertOf(response)?.type, 'success')

    const moved = await db
      .from('deliveries')
      .where('supplier_id', colleague.id)
      .where('product_id', product.id)
      .firstOrFail()
    assert.equal(moved.amount_left, 3)
    assert.equal(new Date(moved.created_at).getTime(), lot.createdAt.toMillis())
    await lot.refresh()
    assert.equal(lot.amountLeft, 0)

    await put(client, admin, supplier, { isDisabled: 'true' })
    await supplier.refresh()
    assert.isTrue(supplier.isDisabled)
  })

  test('stock goes only to an active supplier', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const { supplier, lot } = await supplierWithLot(3, 0)
    const customer = await UserFactory.create()

    const response = await client
      .post(`/admin/users/${supplier.id}/transfer-stock`)
      .loginAs(admin)
      .withCsrfToken()
      .json({ toUserId: customer.id })
      .redirects(0)
    assert.equal(alertOf(response)?.type, 'danger')
    await lot.refresh()
    assert.equal(lot.amountLeft, 3)
  })

  test('only an admin hands stock over', async ({ client, assert }) => {
    const { supplier } = await supplierWithLot(3, 0)
    const colleague = await UserFactory.apply('supplier').create()
    const response = await client
      .post(`/admin/users/${supplier.id}/transfer-stock`)
      .loginAs(colleague)
      .withCsrfToken()
      .json({ toUserId: colleague.id })
      .redirects(0)
    response.assertStatus(302)
    assert.lengthOf(await db.from('deliveries').where('supplier_id', colleague.id), 0)
  })
})

test.group('Admin - payments of a supplier who left', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('an admin confirms the payment of a disabled supplier; not of an active one', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const gone = await UserFactory.apply('supplier').merge({ isDisabled: true }).create()
    const active = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const orphaned = await InvoiceFactory.merge({ supplierId: gone.id, buyerId: buyer.id })
      .apply('paymentRequested')
      .create()
    const theirs = await InvoiceFactory.merge({ supplierId: active.id, buyerId: buyer.id })
      .apply('paymentRequested')
      .create()

    const page = await client
      .get('/admin/invoices')
      .loginAs(admin)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')
    const rows = page.body().props.invoices.data
    assert.isTrue(rows.find((r: any) => r.id === orphaned.id).canSettle)
    assert.isFalse(rows.find((r: any) => r.id === theirs.id).canSettle)

    await client
      .post(`/admin/invoices/${orphaned.id}/payment`)
      .loginAs(admin)
      .withCsrfToken()
      .json({ action: 'approve' })
    const paid = await Invoice.findOrFail(orphaned.id)
    assert.isTrue(paid.isPaid)
    assert.isNotNull(paid.paidAt)
    const audit = await db
      .from('audit_logs')
      .where('action', 'payment.approved')
      .where('entity_id', orphaned.id)
      .firstOrFail()
    assert.equal(Number(audit.user_id), admin.id)
    assert.equal(audit.metadata.onBehalfOf, gone.id)

    const refused = await client
      .post(`/admin/invoices/${theirs.id}/payment`)
      .loginAs(admin)
      .withCsrfToken()
      .json({ action: 'approve' })
      .redirects(0)
    assert.equal(alertOf(refused)?.type, 'danger')
    const untouched = await Invoice.findOrFail(theirs.id)
    assert.isFalse(untouched.isPaid)
  })

  test('an admin rejects a reported payment of a supplier who is a customer now', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const former = await UserFactory.create()
    const buyer = await UserFactory.create()
    const invoice = await InvoiceFactory.merge({ supplierId: former.id, buyerId: buyer.id })
      .apply('paymentRequested')
      .create()

    await client
      .post(`/admin/invoices/${invoice.id}/payment`)
      .loginAs(admin)
      .withCsrfToken()
      .json({ action: 'reject' })
    const rejected = await Invoice.findOrFail(invoice.id)
    assert.isFalse(rejected.isPaymentRequested)
    assert.isFalse(rejected.isPaid)
  })
})
