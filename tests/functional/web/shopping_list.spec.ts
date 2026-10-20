import '#tests/test_context'
import { test } from '@japa/runner'
import { readFileSync } from 'node:fs'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Delivery from '#models/delivery'
import Product from '#models/product'
import ProductGroup from '#models/product_group'
import ShoppingList from '#models/shopping_list'
import StockDraft from '#models/stock_draft'
import StockDraftItem from '#models/stock_draft_item'
import type User from '#models/user'
import {
  ADJUSTMENT_NOTE_MAX,
  INVENTORY_MAX_COUNT,
  INVENTORY_SCOPES,
  LOSS_REASONS,
  WRITE_OFF_REASONS,
} from '#validators/inventory'
import {
  PRODUCT_GROUP_NAME_MAX,
  PRODUCT_GROUP_NOTE_MAX,
  SHOPPING_LABEL_MAX,
  SHOPPING_NOTE_MAX,
  STOCK_DRAFT_MAX_ITEMS,
  STOCK_DRAFT_NOTE_MAX,
} from '#validators/shopping'
import { MAX_HORIZON_DAYS, MIN_HORIZON_DAYS } from '#services/shopping/demand_math'
import { DELIVERY_MAX_AMOUNT } from '#validators/delivery'
import { MAX_MARGIN_PERCENT } from '#services/shopping/pricing'

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

const inertia = { 'x-inertia': 'true', 'x-inertia-version': '1' }

async function groupIdOf(productId: number) {
  const product = await Product.findOrFail(productId)
  return product.productGroupId
}

async function auditActions() {
  const rows = await db.from('audit_logs').select('action')
  return rows.map((row) => row.action)
}

async function draftOf(id: number) {
  return StockDraft.findOrFail(id)
}

test.group('Web Supplier - section access', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  for (const url of [
    '/supplier/shopping-list',
    '/supplier/product-groups',
    '/supplier/stock/drafts',
    '/supplier/inventory',
    '/supplier/finance',
  ]) {
    test(`a customer is turned away from ${url}`, async ({ client }) => {
      const customer = await UserFactory.create()
      const response = await client.get(url).loginAs(customer).redirects(0)
      response.assertStatus(302)
    })

    test(`a supplier can open ${url}`, async ({ client }) => {
      const supplier = await UserFactory.apply('supplier').create()
      const response = await client.get(url).loginAs(supplier)
      response.assertStatus(200)
    })
  }
})

test.group('Web Supplier - shopping list', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  async function view(client: any, supplier: User) {
    const response = await client.get('/supplier/shopping-list').loginAs(supplier).headers(inertia)
    response.assertStatus(200)
    return response.body().props.list
  }

  test('settings are saved and validated', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()

    const saved = await client
      .put('/supplier/shopping-list')
      .loginAs(supplier)
      .withCsrfToken()
      .header('referer', '/supplier/shopping-list')
      .json({ horizonDays: 21, scope: 'all', categoryIds: [category.id] })
      .redirects(0)
    saved.assertStatus(302)

    const list = await view(client, supplier)
    assert.equal(list.settings.horizonDays, 21)
    assert.equal(list.settings.scope, 'all')
    assert.deepEqual(list.settings.categoryIds, [category.id])

    const invalid = await client
      .put('/supplier/shopping-list')
      .loginAs(supplier)
      .withCsrfToken()
      .header('referer', '/supplier/shopping-list')
      .json({ horizonDays: 61 })
      .redirects(0)
    invalid.assertStatus(302)
    const active = await ShoppingList.query().where('supplierId', supplier.id).firstOrFail()
    assert.equal(active.horizonDays, 21)
  })

  test('own lines can be added, changed and removed', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()

    await client
      .post('/supplier/shopping-list/lines')
      .loginAs(supplier)
      .withCsrfToken()
      .header('referer', '/supplier/shopping-list')
      .json({ label: 'Kofola v akci', quantity: 6, unitCost: 19.9 })
      .redirects(0)
    let list = await view(client, supplier)
    const line = list.lines.find((l: any) => l.kind === 'custom')
    assert.equal(line.name, 'Kofola v akci')
    assert.equal(line.quantity, 6)

    await client
      .put(`/supplier/shopping-list/lines/${line.key}`)
      .loginAs(supplier)
      .withCsrfToken()
      .header('referer', '/supplier/shopping-list')
      .json({ quantity: 12, isChecked: true })
      .redirects(0)
    list = await view(client, supplier)
    assert.equal(list.lines[0].quantity, 12)
    assert.isTrue(list.lines[0].isChecked)

    await client
      .delete(`/supplier/shopping-list/lines/${line.key}`)
      .loginAs(supplier)
      .withCsrfToken()
      .header('referer', '/supplier/shopping-list')
      .redirects(0)
    list = await view(client, supplier)
    assert.lengthOf(list.lines, 0)
  })

  test('an own line needs a name or a product', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client
      .post('/supplier/shopping-list/lines')
      .loginAs(supplier)
      .withCsrfToken()
      .header('referer', '/supplier/shopping-list')
      .json({ quantity: 2 })
      .redirects(0)
    response.assertStatus(302)
    assert.lengthOf(await db.from('shopping_list_items'), 0)
  })

  test('a malformed line key does not route', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client
      .put('/supplier/shopping-list/lines/x-1')
      .loginAs(supplier)
      .withCsrfToken()
      .json({ quantity: 1 })
      .redirects(0)
    response.assertStatus(404)
  })

  test('finishing the list turns its lines into a stocking draft', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()

    for (const body of [
      { productId: product.id, quantity: 12, unitCost: 14.9 },
      { label: 'Banány', quantity: 3 },
    ]) {
      await client
        .post('/supplier/shopping-list/lines')
        .loginAs(supplier)
        .withCsrfToken()
        .header('referer', '/supplier/shopping-list')
        .json(body)
        .redirects(0)
    }

    const response = await client
      .post('/supplier/shopping-list/complete')
      .loginAs(supplier)
      .withCsrfToken()
      .redirects(0)
    response.assertStatus(302)
    const draft = await StockDraft.query().where('supplierId', supplier.id).firstOrFail()
    assert.equal(response.header('location'), `/supplier/stock/drafts/${draft.id}`)
    assert.equal(draft.source, 'shopping_list')

    // The product is a draft line; the free-text line has nothing to stock and is noted.
    const items = await StockDraftItem.query().where('stockDraftId', draft.id).orderBy('sortOrder')
    assert.deepEqual(
      items.map((i) => [i.productId, i.label, i.amount, i.purchasePrice]),
      [[product.id, product.displayName, 12, 14.9]]
    )
    assert.match(draft.note ?? '', /^Nákupní seznam \d+\. \d+\. \d{4}\nDále: Banány 3×$/)
    const lists = await ShoppingList.query().where('supplierId', supplier.id)
    assert.deepEqual(
      lists.map((l) => l.status),
      ['done']
    )
    const audit = await db.from('audit_logs').where('action', 'shopping_list.completed').first()
    assert.deepEqual(audit.metadata, { lines: 1, pieces: 12, draftId: draft.id })
  })

  test('an empty list cannot be finished', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client
      .post('/supplier/shopping-list/complete')
      .loginAs(supplier)
      .withCsrfToken()
      .headers(inertia)
      .redirects(1)
    response.assertStatus(200)
    assert.equal(response.body().props.flash.alert.type, 'warn')
    assert.lengthOf(await StockDraft.all(), 0)
  })
})

test.group('Web Supplier - shopping validation mirror', () => {
  test('the frontend validation mirror uses the same limits as the backend', ({ assert }) => {
    // AGENTS.md: the client-side mirror must match the VineJS validators exactly.
    const source = readFileSync('inertia/composables/use_shopping_validation.ts', 'utf-8')
    const constant = (name: string) =>
      Number(new RegExp(`${name} = ([\\d_]+)`).exec(source)?.[1].replaceAll('_', ''))
    const list = (name: string) =>
      [
        ...(new RegExp(`${name} = \\[([^\\]]*)\\]`).exec(source)?.[1] ?? '').matchAll(/'([^']+)'/g),
      ].map((match) => match[1])

    assert.equal(constant('PRODUCT_GROUP_NAME_MAX'), PRODUCT_GROUP_NAME_MAX)
    assert.equal(constant('PRODUCT_GROUP_NOTE_MAX'), PRODUCT_GROUP_NOTE_MAX)
    assert.equal(constant('SHOPPING_LABEL_MAX'), SHOPPING_LABEL_MAX)
    assert.equal(constant('SHOPPING_NOTE_MAX'), SHOPPING_NOTE_MAX)
    assert.equal(constant('STOCK_DRAFT_NOTE_MAX'), STOCK_DRAFT_NOTE_MAX)
    assert.equal(constant('STOCK_DRAFT_MAX_ITEMS'), STOCK_DRAFT_MAX_ITEMS)
    assert.equal(constant('ADJUSTMENT_NOTE_MAX'), ADJUSTMENT_NOTE_MAX)
    assert.equal(constant('INVENTORY_MAX_COUNT'), INVENTORY_MAX_COUNT)
    assert.equal(constant('SHOPPING_MAX_QUANTITY'), DELIVERY_MAX_AMOUNT)
    assert.equal(constant('MIN_HORIZON_DAYS'), MIN_HORIZON_DAYS)
    assert.equal(constant('MAX_HORIZON_DAYS'), MAX_HORIZON_DAYS)
    assert.equal(constant('MAX_MARGIN_PERCENT'), MAX_MARGIN_PERCENT)
    assert.deepEqual(list('WRITE_OFF_REASONS'), [...WRITE_OFF_REASONS])
    assert.deepEqual(list('LOSS_REASONS'), [...LOSS_REASONS])
    // The inventory sheet's scope values — "store" is gone for good.
    assert.deepEqual([...INVENTORY_SCOPES], ['mine', 'all'])
  })
})

test.group('Web Supplier - purchase groups', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a group is created with its products, edited and deleted', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const monster = await ProductFactory.merge({ categoryId: category.id }).create()
    const tiger = await ProductFactory.merge({ categoryId: category.id }).create()

    const created = await client
      .post('/supplier/product-groups')
      .loginAs(supplier)
      .withCsrfToken()
      .header('referer', '/supplier/product-groups')
      .json({
        name: 'Energy s cukrem',
        categoryId: category.id,
        productIds: [monster.id, tiger.id],
      })
      .redirects(0)
    created.assertStatus(302)
    const energy = await ProductGroup.findByOrFail('name', 'Energy s cukrem')
    assert.equal(await groupIdOf(monster.id), energy.id)

    await client
      .put(`/supplier/product-groups/${energy.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .header('referer', '/supplier/product-groups')
      .json({ name: 'Energy drink s cukrem', categoryId: category.id, productIds: [monster.id] })
      .redirects(0)
    const renamed = await ProductGroup.findOrFail(energy.id)
    assert.equal(renamed.name, 'Energy drink s cukrem')
    assert.isNull(await groupIdOf(tiger.id))

    const duplicate = await client
      .post('/supplier/product-groups')
      .loginAs(supplier)
      .withCsrfToken()
      .headers(inertia)
      .header('referer', '/supplier/product-groups')
      .json({ name: 'ENERGY DRINK S CUKREM', categoryId: category.id })
      .redirects(1)
    assert.equal(duplicate.body().props.flash.alert.type, 'danger')
    assert.lengthOf(await ProductGroup.all(), 1)

    await client
      .delete(`/supplier/product-groups/${energy.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .header('referer', '/supplier/product-groups')
      .redirects(0)
    assert.lengthOf(await ProductGroup.all(), 0)
    assert.isNull(await groupIdOf(monster.id))

    const actions = await auditActions()
    assert.includeMembers(actions, [
      'product_group.created',
      'product_group.updated',
      'product_group.deleted',
    ])
  })

  test('a group taking a product over from another group says so in the audit', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const bars = await ProductGroup.create({ name: 'Tyčinky', categoryId: category.id })
    const twix = await ProductFactory.merge({
      categoryId: category.id,
      productGroupId: bars.id,
    }).create()

    await client
      .post('/supplier/product-groups')
      .loginAs(supplier)
      .withCsrfToken()
      .header('referer', '/supplier/product-groups')
      .json({ name: 'Čokoláda', categoryId: category.id, productIds: [twix.id] })
      .redirects(0)

    const audit = await db.from('audit_logs').where('action', 'product_group.created').first()
    assert.deepEqual(audit.metadata.movedFromGroupIds, [bars.id])
  })

  test('archived products are not offered to a list or a group (F6)', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const bars = await ProductGroup.create({ name: 'Tyčinky', categoryId: category.id })
    const active = await ProductFactory.merge({ categoryId: category.id }).create()
    const archived = await ProductFactory.merge({
      categoryId: category.id,
      archivedAt: DateTime.now(),
    }).create()
    const archivedMember = await ProductFactory.merge({
      categoryId: category.id,
      productGroupId: bars.id,
      archivedAt: DateTime.now(),
    }).create()

    const list = await client.get('/supplier/shopping-list').loginAs(supplier).headers(inertia)
    const listIds = list.body().props.products.map((p: { id: number }) => p.id)
    assert.include(listIds, active.id)
    assert.notInclude(listIds, archived.id)
    assert.notInclude(listIds, archivedMember.id)

    const groups = await client.get('/supplier/product-groups').loginAs(supplier).headers(inertia)
    const groupIds = groups.body().props.products.map((p: { id: number }) => p.id)
    assert.include(groupIds, active.id)
    assert.notInclude(groupIds, archived.id)
    // Still a member of its group, so the group shows it.
    assert.include(groupIds, archivedMember.id)
  })

  test('a category with purchase groups cannot be deleted (D-03)', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const category = await CategoryFactory.create()
    await ProductGroup.create({ name: 'Energy', categoryId: category.id })

    const response = await client
      .delete(`/admin/categories/${category.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .headers(inertia)
      .redirects(1)
    assert.equal(response.body().props.flash.alert.type, 'warn')
    assert.lengthOf(await ProductGroup.all(), 1)

    // The database refuses it too — no group is swept away by a hand-written delete.
    await assert.rejects(() => db.from('categories').where('id', category.id).delete())
    assert.lengthOf(await ProductGroup.all(), 1)
  })

  test('the database refuses impossible supplier rows (BE-13)', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const draft = await StockDraft.create({
      supplierId: supplier.id,
      source: 'web',
      status: 'open',
    })
    const now = new Date()
    const insertLine = (amount: number) =>
      db.table('stock_draft_items').insert({
        stock_draft_id: draft.id,
        amount,
        created_at: now,
        updated_at: now,
      })
    await insertLine(1)
    await assert.rejects(() => insertLine(0), /stock_draft_items_amount_check/)
    await assert.rejects(
      () => db.from('users').where('id', supplier.id).update({ margin_percent: 150 }),
      /users_margin_percent_check/
    )
    const list = await ShoppingList.create({
      supplierId: supplier.id,
      status: 'active',
      horizonDays: null,
      scope: 'mine',
      categoryIds: [],
    })
    await assert.rejects(
      () =>
        db.table('shopping_list_items').insert({
          shopping_list_id: list.id,
          kind: 'product',
          label: 'bez produktu',
          created_at: now,
          updated_at: now,
        }),
      /shopping_list_items_kind_refs_check/
    )
  })

  test('the product form puts a product into a group and takes it out', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const bars = await ProductGroup.create({ name: 'Tyčinky', categoryId: category.id })
    const product = await ProductFactory.merge({ categoryId: category.id }).create()

    const update = (groupId: string) =>
      client
        .put(`/supplier/products/${product.id}`)
        .loginAs(supplier)
        .withCsrfToken()
        .field('displayName', product.displayName)
        .field('description', 'Popis')
        .field('categoryId', category.id)
        .field('allergenIds', JSON.stringify([]))
        .field('productGroupId', groupId)
        .redirects(0)

    const assigned = await update(String(bars.id))
    assigned.assertStatus(302)
    assert.equal(await groupIdOf(product.id), bars.id)
    const audit = await db.from('audit_logs').where('action', 'product.updated').first()
    assert.deepEqual(audit.metadata.productGroup, { from: '—', to: 'Tyčinky' })
    const cleared = await update('')
    cleared.assertStatus(302)
    assert.isNull(await groupIdOf(product.id))
  })
})

test.group('Web Supplier - stocking drafts', (group) => {
  group.each.setup(async () => {
    await cleanAll()
    mail.fake()
  })
  group.each.teardown(async () => {
    mail.restore()
    await cleanAll()
  })

  test('a draft is reviewed and stocked at once', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()

    const created = await client
      .post('/supplier/stock/drafts')
      .loginAs(supplier)
      .withCsrfToken()
      .redirects(0)
    created.assertStatus(302)
    const draft = await StockDraft.query().where('supplierId', supplier.id).firstOrFail()
    assert.equal(created.header('location'), `/supplier/stock/drafts/${draft.id}`)

    // Clicking "Stock" again reopens the same draft instead of adding an empty one.
    const again = await client
      .post('/supplier/stock/drafts')
      .loginAs(supplier)
      .withCsrfToken()
      .redirects(0)
    assert.equal(again.header('location'), `/supplier/stock/drafts/${draft.id}`)
    assert.lengthOf(await StockDraft.query().where('supplierId', supplier.id), 1)

    const page = await client
      .get(`/supplier/stock/drafts/${draft.id}`)
      .loginAs(supplier)
      .headers(inertia)
    page.assertStatus(200)
    assert.equal(page.body().props.draft.status, 'open')

    const items = [{ productId: product.id, label: 'PEPSI', amount: 24, purchasePrice: 14.9 }]
    await client
      .put(`/supplier/stock/drafts/${draft.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .header('referer', `/supplier/stock/drafts/${draft.id}`)
      .json({ note: 'Lidl', items })
      .redirects(0)
    const saved = await draftOf(draft.id)
    assert.equal(saved.note, 'Lidl')

    const committed = await client
      .post(`/supplier/stock/drafts/${draft.id}/commit`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ note: 'Lidl', items })
      .redirects(0)
    committed.assertStatus(302)
    assert.equal(committed.header('location'), '/supplier/stock')
    const lot = await Delivery.query().where('productId', product.id).firstOrFail()
    assert.equal(lot.amountSupplied, 24)
    assert.equal(lot.purchasePrice, 14.9)
    assert.equal(lot.price, 15)
  })

  test('an incomplete draft is not stocked', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const created = await client
      .post('/supplier/stock/drafts')
      .loginAs(supplier)
      .withCsrfToken()
      .redirects(0)
    const id = created.header('location')!.split('/').pop()

    const response = await client
      .post(`/supplier/stock/drafts/${id}/commit`)
      .loginAs(supplier)
      .withCsrfToken()
      .headers(inertia)
      .header('referer', `/supplier/stock/drafts/${id}`)
      .json({ items: [{ productId: null, label: 'NEZNÁMÉ', amount: 2, purchasePrice: 9.9 }] })
      .redirects(1)
    assert.equal(response.body().props.flash.alert.type, 'danger')
    assert.lengthOf(await Delivery.all(), 0)
  })

  test('another supplier cannot open or stock my draft', async ({ client, assert }) => {
    const owner = await UserFactory.apply('supplier').create()
    const other = await UserFactory.apply('supplier').create()
    const draft = await StockDraft.create({ supplierId: owner.id, source: 'mcp', status: 'open' })

    const page = await client.get(`/supplier/stock/drafts/${draft.id}`).loginAs(other).redirects(0)
    page.assertStatus(302)
    assert.equal(page.header('location'), '/supplier/stock')

    await client
      .delete(`/supplier/stock/drafts/${draft.id}`)
      .loginAs(other)
      .withCsrfToken()
      .redirects(0)
    const untouched = await draftOf(draft.id)
    assert.equal(untouched.status, 'open')
  })

  test('stocking a product from its row appends a prefilled line and focuses it', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const another = await ProductFactory.merge({ categoryId: category.id }).create()
    await Delivery.create({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 10,
      amountLeft: 10,
      amountLost: 0,
      price: 15,
      purchasePrice: 12.5,
    })

    const created = await client
      .post('/supplier/stock/drafts')
      .loginAs(supplier)
      .withCsrfToken()
      .json({ productId: product.id })
      .redirects(0)
    created.assertStatus(302)
    const match = created
      .header('location')!
      .match(/^\/supplier\/stock\/drafts\/(\d+)\?focus=(\d+)$/)
    assert.isNotNull(match, created.header('location'))
    const [, draftId, itemId] = match!.map(Number)

    const page = await client
      .get(`/supplier/stock/drafts/${draftId}?focus=${itemId}`)
      .loginAs(supplier)
      .headers(inertia)
    page.assertStatus(200)
    const { draft, focusItemId } = page.body().props
    assert.equal(focusItemId, itemId)
    assert.deepEqual(
      draft.items.map((i: any) => [i.id, i.productId, i.amount, i.purchasePrice, i.price]),
      [[itemId, product.id, 1, 12.5, 15]]
    )

    // The next product lands on the same draft as a second line.
    const second = await client
      .post('/supplier/stock/drafts')
      .loginAs(supplier)
      .withCsrfToken()
      .json({ productId: another.id })
      .redirects(0)
    assert.match(
      second.header('location')!,
      new RegExp(`^/supplier/stock/drafts/${draftId}\\?focus=\\d+$`)
    )
    assert.lengthOf(await StockDraftItem.query().where('stockDraftId', draftId), 2)

    const unknown = await client
      .post('/supplier/stock/drafts')
      .loginAs(supplier)
      .withCsrfToken()
      .headers(inertia)
      .header('referer', '/supplier/stock')
      .json({ productId: 999_999 })
      .redirects(1)
    assert.equal(unknown.body().props.flash.alert.type, 'danger')
  })
})
