import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Product from '#models/product'

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

const inertia = { 'X-Inertia': 'true', 'X-Inertia-Version': '1' }

test.group('Supplier UI — "Rozsah" filter visibility', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('is off while every delivery is the supplier’s own, on once a colleague stocked', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()

    const shared = async () => {
      const response = await client.get('/supplier/stock').loginAs(supplier).headers(inertia)
      return response.body().props.hasOtherSuppliers
    }

    // Nobody has stocked anything yet, then only the supplier: "mine" equals "all".
    assert.isFalse(await shared())
    await DeliveryFactory.merge({ supplierId: supplier.id, productId: product.id }).create()
    assert.isFalse(await shared())

    // Even a voided, sold-out lot of a colleague shows up in "Celá lednice" history.
    await DeliveryFactory.merge({
      supplierId: colleague.id,
      productId: product.id,
      amountLeft: 0,
      voidedAt: DateTime.now().minus({ days: 400 }),
    }).create()
    assert.isTrue(await shared())
    // The colleague sees the supplier's lots, so the filter is on for them too.
    const forColleague = await client.get('/supplier/products').loginAs(colleague).headers(inertia)
    assert.isTrue(forColleague.body().props.hasOtherSuppliers)
  })

  test('is never computed for a customer', async ({ client, assert }) => {
    const customer = await UserFactory.create()
    const response = await client.get('/shop').loginAs(customer).headers(inertia)
    response.assertStatus(200)
    assert.isFalse(response.body().props.hasOtherSuppliers)
  })
})

test.group('Supplier UI — product list sorting', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  async function seed() {
    const drinks = await CategoryFactory.merge({ name: 'Nápoje' }).create()
    const snacks = await CategoryFactory.merge({ name: 'Bufet' }).create()
    await ProductFactory.merge({
      categoryId: drinks.id,
      displayName: 'Cola',
      keypadId: 30,
    }).create()
    await ProductFactory.merge({
      categoryId: snacks.id,
      displayName: 'Bueno',
      keypadId: 10,
    }).create()
    await ProductFactory.merge({
      categoryId: drinks.id,
      displayName: 'Aqua',
      keypadId: 20,
    }).create()
  }

  test('defaults to name A→Z and echoes the applied sort in filters', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    await seed()

    const response = await client.get('/supplier/products').loginAs(supplier).headers(inertia)
    response.assertStatus(200)
    const props = response.body().props
    assert.deepEqual(
      props.products.data.map((p: { displayName: string }) => p.displayName),
      ['Aqua', 'Bueno', 'Cola']
    )
    assert.deepEqual(props.filters, {
      search: '',
      categoryId: '',
      sortBy: 'displayName',
      sortOrder: 'asc',
      status: 'active',
      photo: '',
    })
  })

  test('sorts by keypad code and by category name, whitelisting the field', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    await seed()
    const names = async (query: string) => {
      const response = await client
        .get(`/supplier/products?${query}`)
        .loginAs(supplier)
        .headers(inertia)
      return response.body().props.products.data.map((p: { displayName: string }) => p.displayName)
    }

    assert.deepEqual(await names('sortBy=keypadId&sortOrder=desc'), ['Cola', 'Aqua', 'Bueno'])
    // Category name, then the id as a stable tie-breaker within a category.
    assert.deepEqual(await names('sortBy=category&sortOrder=asc'), ['Bueno', 'Cola', 'Aqua'])
    assert.deepEqual(await names('sortBy=category&sortOrder=desc'), ['Cola', 'Aqua', 'Bueno'])
    // Unknown columns fall back to the default instead of reaching SQL.
    const fallback = await client
      .get('/supplier/products?sortBy=password&sortOrder=sideways')
      .loginAs(supplier)
      .headers(inertia)
    fallback.assertStatus(200)
    assert.equal(fallback.body().props.filters.sortBy, 'displayName')
    assert.equal(fallback.body().props.filters.sortOrder, 'asc')
  })

  test('a malformed category filter is ignored instead of failing', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    await seed()
    const response = await client
      .get('/supplier/products?categoryId=99999999999')
      .loginAs(supplier)
      .headers(inertia)
    response.assertStatus(200)
    assert.lengthOf(response.body().props.products.data, 3)
    assert.equal(response.body().props.filters.categoryId, '')
  })
})

function alertOf(response: { flashMessages(): unknown }) {
  const flash = response.flashMessages() as { alert?: { type: string; message: string } } | null
  return flash?.alert
}

test.group('Supplier UI — archiving products', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('archives a sold-out product, keeps the list query and restores it again', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const listUrl = '/supplier/products?status=all&sortBy=keypadId&sortOrder=desc'

    const archived = await client
      .post(`/supplier/products/${product.id}/archive`)
      .header('referer', `http://localhost${listUrl}`)
      .loginAs(supplier)
      .withCsrfToken()
      .redirects(0)
    archived.assertStatus(302)
    assert.equal(archived.header('location'), listUrl)
    assert.equal(alertOf(archived)?.type, 'success')
    await product.refresh()
    assert.isNotNull(product.archivedAt)

    const list = await client.get(listUrl).loginAs(supplier).headers(inertia)
    const row = list.body().props.products.data.find((p: { id: number }) => p.id === product.id)
    assert.isTrue(row.archived)
    const active = await client.get('/supplier/products').loginAs(supplier).headers(inertia)
    assert.lengthOf(active.body().props.products.data, 0)

    const restored = await client
      .post(`/supplier/products/${product.id}/unarchive`)
      .loginAs(supplier)
      .withCsrfToken()
      .redirects(0)
    restored.assertStatus(302)
    await product.refresh()
    assert.isNull(product.archivedAt)
  })

  test('refuses while pieces are left, and a customer cannot archive at all', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const customer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await DeliveryFactory.merge({ supplierId: supplier.id, productId: product.id }).create()

    const refused = await client
      .post(`/supplier/products/${product.id}/archive`)
      .loginAs(supplier)
      .withCsrfToken()
      .redirects(0)
    refused.assertStatus(302)
    assert.equal(alertOf(refused)?.type, 'danger')

    const forbidden = await client
      .post(`/supplier/products/${product.id}/archive`)
      .loginAs(customer)
      .withCsrfToken()
      .redirects(0)
    assert.notEqual(forbidden.status(), 200)

    await product.refresh()
    assert.isNull(product.archivedAt)
  })
})

test.group('Supplier UI — optional photo and description', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a product is created from a name and a category alone', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()

    const response = await client
      .post('/supplier/products')
      .loginAs(supplier)
      .withCsrfToken()
      .field('displayName', 'Bez fotky')
      .field('description', '')
      .field('categoryId', category.id)
      .field('allergenIds', JSON.stringify([]))
      .redirects(0)
    response.assertStatus(302)
    assert.match(response.header('location') ?? '', /^\/supplier\/stock\/drafts\/\d+/)

    const product = await Product.findByOrFail('displayName', 'Bez fotky')
    assert.isNull(product.imagePath)
    assert.equal(product.description, '')

    const missing = await client
      .get('/supplier/products?photo=missing')
      .loginAs(supplier)
      .headers(inertia)
    assert.deepEqual(
      missing.body().props.products.data.map((p: { id: number }) => p.id),
      [product.id]
    )
    assert.equal(missing.body().props.filters.photo, 'missing')
  })

  test('a malformed draft id on the new-product form is ignored', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client
      .get('/supplier/products/new?draftId=99999999999&groupId=abc')
      .loginAs(supplier)
      .headers(inertia)
    response.assertStatus(200)
    assert.isNull(response.body().props.fromDraft)
  })
})
