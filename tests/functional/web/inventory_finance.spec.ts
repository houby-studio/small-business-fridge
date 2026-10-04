import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Delivery from '#models/delivery'
import InventoryCount from '#models/inventory_count'
import StockAdjustment from '#models/stock_adjustment'
import StockDraft from '#models/stock_draft'
import User from '#models/user'
import InventoryService from '#services/inventory_service'

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

const inertia = { 'x-inertia': 'true', 'x-inertia-version': '1' }

async function marginOf(userId: number) {
  const user = await User.findOrFail(userId)
  return user.marginPercent
}

async function stocked(supplier: User, amount = 6, left = amount) {
  const category = await CategoryFactory.create()
  const product = await ProductFactory.merge({ categoryId: category.id }).create()
  const lot = await Delivery.create({
    supplierId: supplier.id,
    productId: product.id,
    amountSupplied: amount,
    amountLeft: left,
    amountLost: 0,
    price: 20,
    purchasePrice: 17.5,
  })
  return { product, lot }
}

test.group('Web Supplier - purchase price on stocking', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('stocking through a draft stores what the supplier paid', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const draft = await StockDraft.create({
      supplierId: supplier.id,
      source: 'web',
      status: 'open',
    })

    const response = await client
      .post(`/supplier/stock/drafts/${draft.id}/commit`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ items: [{ productId: product.id, amount: 24, price: 15, purchasePrice: 14.9 }] })
      .redirects(0)
    response.assertStatus(302)
    assert.equal(response.header('location'), '/supplier/stock')

    const lot = await Delivery.query().where('productId', product.id).firstOrFail()
    assert.equal(lot.purchasePrice, 14.9)
    assert.equal(lot.price, 15)
    const audit = await db.from('audit_logs').where('action', 'delivery.created').first()
    assert.equal(audit.metadata.purchasePrice, 14.9)
  })

  test('a purchase price with fractions of a cent is refused', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const draft = await StockDraft.create({
      supplierId: supplier.id,
      source: 'web',
      status: 'open',
    })

    const response = await client
      .post(`/supplier/stock/drafts/${draft.id}/commit`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ items: [{ productId: product.id, amount: 1, price: 15, purchasePrice: 14.999 }] })
      .redirects(0)
    response.assertStatus(302)
    assert.lengthOf(await Delivery.all(), 0)
    await draft.refresh()
    assert.equal(draft.status, 'open')
  })
})

test.group('Web Supplier - write-offs and inventory', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a write-off takes pieces off the stock', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const { product, lot } = await stocked(supplier)

    const response = await client
      .post('/supplier/stock/write-offs')
      .loginAs(supplier)
      .withCsrfToken()
      .headers(inertia)
      .header('referer', '/supplier/stock')
      .json({ productId: product.id, quantity: 2, reason: 'expired', note: 'prošlé' })
      .redirects(1)
    assert.equal(response.body().props.flash.alert.type, 'success')
    await lot.refresh()
    assert.equal(lot.amountLeft, 4)
    assert.equal(lot.amountLost, 2)
  })

  test('writing off more than is in stock is refused', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const { product, lot } = await stocked(supplier, 6, 1)

    const response = await client
      .post('/supplier/stock/write-offs')
      .loginAs(supplier)
      .withCsrfToken()
      .headers(inertia)
      .header('referer', '/supplier/stock')
      .json({ productId: product.id, quantity: 2, reason: 'damaged' })
      .redirects(1)
    assert.equal(response.body().props.flash.alert.type, 'danger')
    await lot.refresh()
    assert.equal(lot.amountLeft, 1)
  })

  test('an inventory is listed, committed and shown', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const { product, lot } = await stocked(supplier, 10, 8)

    const page = await client.get('/supplier/inventory').loginAs(supplier).headers(inertia)
    page.assertStatus(200)
    assert.deepEqual(
      page.body().props.products.map((p: any) => [p.productId, p.stock]),
      [[product.id, 8]]
    )

    const committed = await client
      .post('/supplier/inventory')
      .loginAs(supplier)
      .withCsrfToken()
      .json({ scope: 'mine', items: [{ productId: product.id, expected: 8, counted: 6 }] })
      .redirects(0)
    committed.assertStatus(302)
    const count = await InventoryCount.firstOrFail()
    assert.equal(committed.header('location'), `/supplier/inventory/${count.id}`)
    await lot.refresh()
    assert.equal(lot.amountLeft, 6)
    assert.lengthOf(await StockAdjustment.all(), 1)

    const detail = await client
      .get(`/supplier/inventory/${count.id}`)
      .loginAs(supplier)
      .headers(inertia)
    detail.assertStatus(200)
    assert.equal(detail.body().props.count.items[0].appliedQty, -2)
  })

  test('the sheet covers the whole fridge on request; "store" is no longer a scope', async ({
    client,
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const { product: mine } = await stocked(me)
    const { product: theirs } = await stocked(colleague)

    const own = await client.get('/supplier/inventory').loginAs(me).headers(inertia)
    assert.deepEqual(
      own.body().props.products.map((p: any) => p.productId),
      [mine.id]
    )
    assert.equal(own.body().props.filters.scope, 'mine')

    const whole = await client
      .get('/supplier/inventory')
      .qs({ scope: 'all' })
      .loginAs(me)
      .headers(inertia)
    assert.sameMembers(
      whole.body().props.products.map((p: any) => p.productId),
      [mine.id, theirs.id]
    )
    assert.equal(whole.body().props.filters.scope, 'all')

    const legacy = await client
      .get('/supplier/inventory')
      .qs({ scope: 'store' })
      .loginAs(me)
      .headers(inertia)
    assert.equal(legacy.body().props.filters.scope, 'mine')

    const refused = await client
      .post('/supplier/inventory')
      .loginAs(me)
      .withCsrfToken()
      .header('referer', '/supplier/inventory')
      .json({ scope: 'store', items: [{ productId: mine.id, expected: 6, counted: 5 }] })
      .redirects(0)
    refused.assertStatus(302)
    assert.lengthOf(await InventoryCount.all(), 0)

    const committed = await client
      .post('/supplier/inventory')
      .loginAs(me)
      .withCsrfToken()
      .json({ scope: 'all', items: [{ productId: theirs.id, expected: 6, counted: 5 }] })
      .redirects(0)
    committed.assertStatus(302)
    const count = await InventoryCount.firstOrFail()
    assert.equal(count.scope, 'all')
  })

  test('past inventories are mine by default and everyone’s on request', async ({
    client,
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const { product } = await stocked(me, 10, 8)
    const service = new InventoryService()
    const mine = await service.commitCount(me, {
      scope: 'mine',
      items: [{ productId: product.id, expected: 8, counted: 8 }],
    })
    const theirs = await service.commitCount(colleague, {
      scope: 'all',
      items: [{ productId: product.id, expected: 8, counted: 7 }],
    })

    const own = await client.get('/supplier/inventory').loginAs(me).headers(inertia)
    assert.deepEqual(
      own.body().props.counts.data.map((c: any) => c.id),
      [mine.id]
    )
    assert.equal(own.body().props.filters.who, 'mine')

    const everyone = await client
      .get('/supplier/inventory')
      .qs({ who: 'all' })
      .loginAs(me)
      .headers(inertia)
    assert.deepEqual(
      everyone.body().props.counts.data.map((c: any) => c.id),
      [theirs.id, mine.id]
    )
    assert.equal(everyone.body().props.filters.who, 'all')
  })

  test('a stolen piece can be written off', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const { product, lot } = await stocked(supplier)

    await client
      .post('/supplier/stock/write-offs')
      .loginAs(supplier)
      .withCsrfToken()
      .header('referer', '/supplier/stock')
      .json({ productId: product.id, quantity: 1, reason: 'stolen' })
      .redirects(0)
    const [row] = await StockAdjustment.query().where('deliveryId', lot.id)
    assert.equal(row.reason, 'stolen')
  })

  test('an inventory without counted products is refused', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client
      .post('/supplier/inventory')
      .loginAs(supplier)
      .withCsrfToken()
      .header('referer', '/supplier/inventory')
      .json({ scope: 'mine', items: [] })
      .redirects(0)
    response.assertStatus(302)
    assert.lengthOf(await InventoryCount.all(), 0)
  })
})

test.group('Web Supplier - finance', (group) => {
  let previousLimit: number | undefined

  group.each.setup(async () => {
    previousLimit = env.get('SUPPLIER_INCOME_LIMIT')
    await cleanAll()
  })
  group.each.teardown(async () => {
    env.set('SUPPLIER_INCOME_LIMIT', previousLimit ?? 0)
    await cleanAll()
  })

  test('the finance page shows the year and the configured limit', async ({ client, assert }) => {
    env.set('SUPPLIER_INCOME_LIMIT', 50_000)
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client.get('/supplier/finance').loginAs(supplier).headers(inertia)
    response.assertStatus(200)
    const { summary, years, products } = response.body().props
    assert.equal(summary.year, years[0])
    assert.isTrue(summary.incomeLimit.enabled)
    assert.equal(summary.incomeLimit.limit, 50_000)
    assert.notProperty(summary.incomeLimit, 'basis')
    assert.deepEqual(summary.ownConsumption, { units: 0, value: 0 })
    assert.deepEqual(summary.shrinkage.byReason, [])
    assert.deepInclude(summary.shrinkage, { surplusUnits: 0, surplusCost: 0, lossCost: 0 })
    assert.equal(products.meta.total, 0)
    // The write-off table moved to the stock history page.
    assert.notProperty(response.body().props, 'adjustments')
  })

  test('the margin is saved, audited and validated', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()

    const saved = await client
      .put('/supplier/finance/settings')
      .loginAs(supplier)
      .withCsrfToken()
      .header('referer', '/supplier/finance')
      .json({ marginPercent: 5.5 })
      .redirects(0)
    saved.assertStatus(302)
    assert.equal(await marginOf(supplier.id), 5.5)
    const audit = await db.from('audit_logs').where('action', 'supplier.settings_updated').first()
    assert.deepEqual(audit.metadata.marginPercent, { from: 0, to: 5.5 })

    await client
      .put('/supplier/finance/settings')
      .loginAs(supplier)
      .withCsrfToken()
      .header('referer', '/supplier/finance')
      .json({ marginPercent: 150 })
      .redirects(0)
    assert.equal(await marginOf(supplier.id), 5.5)
  })

  test('the stock page warns once the yearly limit is near', async ({ client, assert }) => {
    env.set('SUPPLIER_INCOME_LIMIT', 100)
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const { lot } = await stocked(supplier, 10, 5)
    // Five sold to a colleague, three eaten by the supplier — only the five count.
    await db.table('orders').multiInsert(
      [
        ...Array.from({ length: 5 }, () => buyer.id),
        ...Array.from({ length: 3 }, () => supplier.id),
      ].map((buyerId) => ({
        buyer_id: buyerId,
        delivery_id: lot.id,
        channel: 'web',
        unit_price: 20,
        created_at: new Date(),
        updated_at: new Date(),
      }))
    )

    const response = await client.get('/supplier/stock').loginAs(supplier).headers(inertia)
    assert.equal(response.body().props.incomeLimit.level, 'exceeded')
    assert.equal(response.body().props.incomeLimit.amount, 100)
  })
})

test.group('Web Supplier - classifying an inventory shortfall', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  async function countWithShortfall(supplier: User) {
    const { product } = await stocked(supplier, 10, 8)
    const count = await new InventoryService().commitCount(supplier, {
      scope: 'mine',
      items: [{ productId: product.id, expected: 8, counted: 6 }],
    })
    return { product, count }
  }

  async function reasonsOf(countId: number) {
    const rows = await StockAdjustment.query().where('inventoryCountId', countId)
    return rows.map((row) => row.reason)
  }

  test('a supplier gives the missing pieces a reason', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const { product, count } = await countWithShortfall(supplier)

    const response = await client
      .put(`/supplier/inventory/${count.id}/products/${product.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .headers(inertia)
      .header('referer', `/supplier/inventory/${count.id}`)
      .json({ reason: 'stolen' })
      .redirects(1)
    const { flash, count: detail } = response.body().props
    assert.equal(flash.alert.type, 'success')
    assert.deepEqual(
      detail.adjustments.map((a: { reason: string }) => a.reason),
      ['stolen']
    )
    assert.deepEqual(await reasonsOf(count.id), ['stolen'])
    const audit = await db.from('audit_logs').where('action', 'stock.reclassified').first()
    assert.equal(audit.metadata.from, 'inventory')
    assert.equal(audit.metadata.to, 'stolen')
  })

  test('a supplier with no part in the count cannot classify its shortfall', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const bystander = await UserFactory.apply('supplier').create()
    const { product, count } = await countWithShortfall(supplier)

    const response = await client
      .put(`/supplier/inventory/${count.id}/products/${product.id}`)
      .loginAs(bystander)
      .withCsrfToken()
      .headers(inertia)
      .header('referer', `/supplier/inventory/${count.id}`)
      .json({ reason: 'stolen' })
      .redirects(1)
    assert.equal(response.body().props.flash.alert.type, 'danger')
    assert.equal(response.body().props.flash.alert.message, 'Tuto akci nemáte oprávnění provést.')
    assert.deepEqual(await reasonsOf(count.id), ['inventory'])

    const admin = await UserFactory.apply('admin').create()
    const allowed = await client
      .put(`/supplier/inventory/${count.id}/products/${product.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .headers(inertia)
      .header('referer', `/supplier/inventory/${count.id}`)
      .json({ reason: 'stolen' })
      .redirects(1)
    assert.equal(allowed.body().props.flash.alert.type, 'success')
    assert.deepEqual(await reasonsOf(count.id), ['stolen'])
  })

  test('a customer cannot classify a shortfall', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const customer = await UserFactory.create()
    const { product, count } = await countWithShortfall(supplier)

    const response = await client
      .put(`/supplier/inventory/${count.id}/products/${product.id}`)
      .loginAs(customer)
      .withCsrfToken()
      .json({ reason: 'stolen' })
      .redirects(0)
    response.assertStatus(302)
    assert.equal(response.header('location'), '/')
    assert.deepEqual(await reasonsOf(count.id), ['inventory'])
  })

  test('an unknown reason and a product without shortfall are refused', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const { product, count } = await countWithShortfall(supplier)

    const invalid = await client
      .put(`/supplier/inventory/${count.id}/products/${product.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .header('referer', `/supplier/inventory/${count.id}`)
      .json({ reason: 'eaten' })
      .redirects(0)
    invalid.assertStatus(302)
    assert.deepEqual(await reasonsOf(count.id), ['inventory'])

    const untouched = await client
      .put(`/supplier/inventory/${count.id}/products/${product.id + 1}`)
      .loginAs(supplier)
      .withCsrfToken()
      .headers(inertia)
      .header('referer', `/supplier/inventory/${count.id}`)
      .json({ reason: 'stolen' })
      .redirects(1)
    assert.equal(untouched.body().props.flash.alert.type, 'danger')
    assert.deepEqual(await reasonsOf(count.id), ['inventory'])

    const notAnId = await client
      .put(`/supplier/inventory/${count.id}/products/abc`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ reason: 'stolen' })
      .redirects(0)
    notAnId.assertStatus(404)
  })
})
