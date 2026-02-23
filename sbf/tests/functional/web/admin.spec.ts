import '#tests/test_context'
import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import { InvoiceFactory } from '#database/factories/invoice_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { OrderFactory } from '#database/factories/order_factory'
import Invoice from '#models/invoice'
import Allergen from '#models/allergen'
import db from '@adonisjs/lucid/services/db'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('user_favorites').delete()
  await db.from('orders').delete()
  await db.from('invoices').delete()
  await db.from('deliveries').delete()
  await db.from('product_allergen').delete()
  await db.from('products').delete()
  await db.from('allergens').delete()
  await db.from('categories').delete()
  await db.from('auth_access_tokens').delete()
  await db.from('users').delete()
}

test.group('Admin - users search and filter', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('admin can view users page', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const response = await client.get('/admin/users').loginAs(admin)
    response.assertStatus(200)
  })

  test('customer cannot access admin users page', async ({ client }) => {
    const customer = await UserFactory.create()
    const response = await client.get('/admin/users').loginAs(customer).redirects(0)
    response.assertStatus(302)
  })

  test('search by name returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    await UserFactory.create()

    const response = await client.get('/admin/users?search=test').loginAs(admin)
    response.assertStatus(200)
  })

  test('filter by role returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    await UserFactory.apply('supplier').create()

    const response = await client.get('/admin/users?role=supplier').loginAs(admin)
    response.assertStatus(200)
  })

  test('search and role filter combined returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()

    const response = await client.get('/admin/users?search=john&role=customer').loginAs(admin)
    response.assertStatus(200)
  })

  test('filter by userId returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const user = await UserFactory.create()

    const response = await client.get(`/admin/users?userId=${user.id}`).loginAs(admin)
    response.assertStatus(200)
  })
})

test.group('Admin - orders filter', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('admin can view orders page', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const response = await client.get('/admin/orders').loginAs(admin)
    response.assertStatus(200)
  })

  test('filter by channel=web returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: admin.id,
      productId: product.id,
      amountLeft: 5,
      price: 20,
    }).create()
    await OrderFactory.merge({
      buyerId: buyer.id,
      deliveryId: delivery.id,
      channel: 'web',
    }).create()

    const response = await client.get('/admin/orders?channel=web').loginAs(admin)
    response.assertStatus(200)
  })

  test('filter by invoiced=no returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: admin.id,
      productId: product.id,
      amountLeft: 5,
      price: 20,
    }).create()
    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()

    const response = await client.get('/admin/orders?invoiced=no').loginAs(admin)
    response.assertStatus(200)
  })

  test('search by buyer name returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()

    const response = await client.get('/admin/orders?search=alice').loginAs(admin)
    response.assertStatus(200)
  })
})

test.group('Admin - invoices filter', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('admin can view invoices page', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const response = await client.get('/admin/invoices').loginAs(admin)
    response.assertStatus(200)
  })

  test('filter by status=paid returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    await InvoiceFactory.apply('paid')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client.get('/admin/invoices?status=paid').loginAs(admin)
    response.assertStatus(200)
  })

  test('filter by status=unpaid returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()

    const response = await client.get('/admin/invoices?status=unpaid').loginAs(admin)
    response.assertStatus(200)
  })

  test('filter by status=awaiting returns 200', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()

    const response = await client.get('/admin/invoices?status=awaiting').loginAs(admin)
    response.assertStatus(200)
  })
})

test.group('Admin - generate invoice for user', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('admin can generate invoices for a user across all suppliers', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 5,
      price: 15,
    }).create()

    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()

    const response = await client
      .post(`/admin/users/${buyer.id}/generate-invoice`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/admin/users')

    const invoices = await Invoice.query().where('buyerId', buyer.id)
    assert.lengthOf(invoices, 1)
    assert.equal(invoices[0].totalCost, 15)
  })

  test('disable user with uninvoiced orders is blocked', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: admin.id,
      productId: product.id,
      amountLeft: 5,
      price: 10,
    }).create()

    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()

    const response = await client
      .put(`/admin/users/${buyer.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .form({ isDisabled: 'true' })
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/admin/users')

    // User must not be disabled
    await buyer.refresh()
    assert.isFalse(buyer.isDisabled)
  })

  test('disable user with unpaid invoices is blocked', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()

    await InvoiceFactory.merge({ buyerId: buyer.id, supplierId: supplier.id }).create()

    const response = await client
      .put(`/admin/users/${buyer.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .form({ isDisabled: 'true' })
      .redirects(0)

    response.assertStatus(302)

    await buyer.refresh()
    assert.isFalse(buyer.isDisabled)
  })

  test('disable user with no pending items succeeds', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()

    const response = await client
      .put(`/admin/users/${buyer.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .form({ isDisabled: 'true' })
      .redirects(0)

    response.assertStatus(302)

    await buyer.refresh()
    assert.isTrue(buyer.isDisabled)
  })

  test('customer cannot call generate invoice for user endpoint', async ({ client }) => {
    const customer = await UserFactory.create()
    const buyer = await UserFactory.create()

    const response = await client
      .post(`/admin/users/${buyer.id}/generate-invoice`)
      .loginAs(customer)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    // Role middleware redirects non-admins away
  })

  test('supplier cannot call generate invoice for user endpoint', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()

    const response = await client
      .post(`/admin/users/${buyer.id}/generate-invoice`)
      .loginAs(supplier)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
  })
})

test.group('Admin - users index flags', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('user with uninvoiced orders has hasUninvoicedOrders=true in response', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 5,
      price: 10,
    }).create()

    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()

    const response = await client
      .get('/admin/users')
      .loginAs(admin)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')

    response.assertStatus(200)
    const body = response.body()
    const users: any[] = body.props.users.data
    const buyerRow = users.find((u: any) => u.id === buyer.id)

    assert.isDefined(buyerRow, 'buyer should appear in user list')
    assert.isTrue(buyerRow.hasUninvoicedOrders)
    assert.isFalse(buyerRow.hasUnpaidInvoices)
  })

  test('user with unpaid invoice has hasUnpaidInvoices=true in response', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()

    await InvoiceFactory.merge({ buyerId: buyer.id, supplierId: supplier.id }).create()

    const response = await client
      .get('/admin/users')
      .loginAs(admin)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')

    response.assertStatus(200)
    const body = response.body()
    const users: any[] = body.props.users.data
    const buyerRow = users.find((u: any) => u.id === buyer.id)

    assert.isDefined(buyerRow, 'buyer should appear in user list')
    assert.isFalse(buyerRow.hasUninvoicedOrders)
    assert.isTrue(buyerRow.hasUnpaidInvoices)
  })

  test('user with no pending items has both flags false', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()

    const response = await client
      .get('/admin/users')
      .loginAs(admin)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')

    response.assertStatus(200)
    const body = response.body()
    const users: any[] = body.props.users.data
    const buyerRow = users.find((u: any) => u.id === buyer.id)

    assert.isDefined(buyerRow, 'buyer should appear in user list')
    assert.isFalse(buyerRow.hasUninvoicedOrders)
    assert.isFalse(buyerRow.hasUnpaidInvoices)
  })
})

test.group('Admin - allergens CRUD', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('admin can view allergens page', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const response = await client.get('/admin/allergens').loginAs(admin)
    response.assertStatus(200)
  })

  test('admin can create allergen', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const response = await client
      .post('/admin/allergens')
      .loginAs(admin)
      .withCsrfToken()
      .form({ name: 'Lepek' })
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/admin/allergens')

    const allergen = await Allergen.findBy('name', 'Lepek')
    assert.isNotNull(allergen)
    assert.equal(allergen!.name, 'Lepek')
    assert.isFalse(allergen!.isDisabled)
  })

  test('creating an allergen writes allergen.created audit entry', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()

    const response = await client
      .post('/admin/allergens')
      .loginAs(admin)
      .withCsrfToken()
      .form({ name: 'Sesame' })
      .redirects(0)

    response.assertStatus(302)

    const allergen = await Allergen.findByOrFail('name', 'Sesame')
    const log = await db
      .from('audit_logs')
      .where('action', 'allergen.created')
      .where('entity_type', 'allergen')
      .where('entity_id', allergen.id)
      .first()

    assert.isDefined(log, 'allergen.created audit log should exist')
    assert.equal(log.user_id, admin.id)
  })

  test('admin can update allergen', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const allergen = await Allergen.create({ name: 'Lepek', isDisabled: false })

    const response = await client
      .put(`/admin/allergens/${allergen.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .form({ name: 'Gluten' })
      .redirects(0)

    response.assertStatus(302)
    await allergen.refresh()
    assert.equal(allergen.name, 'Gluten')
  })

  test('admin can toggle allergen isDisabled', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const allergen = await Allergen.create({ name: 'Lepek', isDisabled: false })

    const response = await client
      .put(`/admin/allergens/${allergen.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .form({ isDisabled: 'true' })
      .redirects(0)

    response.assertStatus(302)
    await allergen.refresh()
    assert.isTrue(allergen.isDisabled)
  })

  test('disable allergen with tied products is blocked', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const allergen = await Allergen.create({ name: 'Milk', isDisabled: false })
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await product.related('allergens').attach([allergen.id])

    const response = await client
      .put(`/admin/allergens/${allergen.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .form({ isDisabled: 'true' })
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/admin/allergens')
    await allergen.refresh()
    assert.isFalse(allergen.isDisabled)
  })

  test('allergen with tied products has hasProducts=true in response', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const allergen = await Allergen.create({ name: 'Soy', isDisabled: false })
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await product.related('allergens').attach([allergen.id])

    const response = await client
      .get('/admin/allergens')
      .loginAs(admin)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')

    response.assertStatus(200)
    const body = response.body()
    const rows: any[] = body.props.allergens
    const allergenRow = rows.find((row: any) => row.id === allergen.id)

    assert.isDefined(allergenRow, 'allergen should appear in allergens list')
    assert.isTrue(allergenRow.hasProducts)
  })

  test('updating an allergen writes allergen.updated audit entry', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const allergen = await Allergen.create({ name: 'Lepek', isDisabled: false })

    const response = await client
      .put(`/admin/allergens/${allergen.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .form({ name: 'Gluten', isDisabled: 'true' })
      .redirects(0)

    response.assertStatus(302)

    const log = await db
      .from('audit_logs')
      .where('action', 'allergen.updated')
      .where('entity_type', 'allergen')
      .where('entity_id', allergen.id)
      .first()

    assert.isDefined(log, 'allergen.updated audit log should exist')
    assert.equal(log.user_id, admin.id)

    const metadata = log.metadata as Record<string, { from: unknown; to: unknown }> | null
    assert.isNotNull(metadata)
    assert.deepEqual(metadata!.name, { from: 'Lepek', to: 'Gluten' })
    assert.deepEqual(metadata!.isDisabled, { from: false, to: true })
  })

  test('updating an allergen with no real change does not write allergen.updated audit entry', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const allergen = await Allergen.create({ name: 'Lepek', isDisabled: false })

    const response = await client
      .put(`/admin/allergens/${allergen.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .form({ name: 'Lepek' })
      .redirects(0)

    response.assertStatus(302)

    const log = await db
      .from('audit_logs')
      .where('action', 'allergen.updated')
      .where('entity_type', 'allergen')
      .where('entity_id', allergen.id)
      .first()

    assert.isNull(log)
  })

  test('customer cannot access admin allergens page', async ({ client }) => {
    const customer = await UserFactory.create()
    const response = await client.get('/admin/allergens').loginAs(customer).redirects(0)
    response.assertStatus(302)
  })
})

test.group('Admin - category audit logging', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('creating a category writes category.created audit entry', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()

    const response = await client
      .post('/admin/categories')
      .loginAs(admin)
      .withCsrfToken()
      .form({ name: 'Drinks', color: '#123456' })
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/admin/categories')

    const log = await db
      .from('audit_logs')
      .where('action', 'category.created')
      .where('entity_type', 'category')
      .first()

    assert.isDefined(log, 'category.created audit log should exist')
    assert.equal(log.user_id, admin.id)
  })

  test('updating a category writes category.updated audit entry', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const category = await CategoryFactory.merge({ name: 'Food', color: '#aaaaaa' }).create()

    const response = await client
      .put(`/admin/categories/${category.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .form({ name: 'Snacks', color: '#bbbbbb', isDisabled: 'true' })
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/admin/categories')

    const log = await db
      .from('audit_logs')
      .where('action', 'category.updated')
      .where('entity_type', 'category')
      .where('entity_id', category.id)
      .first()

    assert.isDefined(log, 'category.updated audit log should exist')
    assert.equal(log.user_id, admin.id)

    const metadata = log.metadata as Record<string, { from: unknown; to: unknown }> | null
    assert.isNotNull(metadata)
    assert.deepEqual(metadata!.name, { from: 'Food', to: 'Snacks' })
    assert.deepEqual(metadata!.color, { from: '#aaaaaa', to: '#bbbbbb' })
    assert.deepEqual(metadata!.isDisabled, { from: false, to: true })
  })

  test('disable category with tied products is blocked', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const category = await CategoryFactory.create()
    await ProductFactory.merge({ categoryId: category.id }).create()

    const response = await client
      .put(`/admin/categories/${category.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .form({ isDisabled: 'true' })
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/admin/categories')
    await category.refresh()
    assert.isFalse(category.isDisabled)
  })

  test('category with tied products has hasProducts=true in response', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const category = await CategoryFactory.create()
    await ProductFactory.merge({ categoryId: category.id }).create()

    const response = await client
      .get('/admin/categories')
      .loginAs(admin)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')

    response.assertStatus(200)
    const body = response.body()
    const rows: any[] = body.props.categories
    const categoryRow = rows.find((row: any) => row.id === category.id)

    assert.isDefined(categoryRow, 'category should appear in categories list')
    assert.isTrue(categoryRow.hasProducts)
  })

  test('updating a category with no real change does not write category.updated audit entry', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const category = await CategoryFactory.merge({ name: 'Food', color: '#aaaaaa' }).create()

    const response = await client
      .put(`/admin/categories/${category.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .form({ name: 'Food', color: '#aaaaaa' })
      .redirects(0)

    response.assertStatus(302)

    const log = await db
      .from('audit_logs')
      .where('action', 'category.updated')
      .where('entity_type', 'category')
      .where('entity_id', category.id)
      .first()

    assert.isNull(log)
  })
})
