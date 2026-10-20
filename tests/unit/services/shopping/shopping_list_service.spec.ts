import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Delivery from '#models/delivery'
import ProductGroup from '#models/product_group'
import ShoppingList from '#models/shopping_list'
import ShoppingListItem from '#models/shopping_list_item'
import StockDraft from '#models/stock_draft'
import StockDraftItem from '#models/stock_draft_item'
import type User from '#models/user'
import { FRIDGE_TIMEZONE } from '#config/fridge'
import ShoppingListService, { parseLineKey } from '#services/shopping/shopping_list_service'

const service = new ShoppingListService()

// The plan reads every sale and lot in the database, so start from an empty one — also
// after an e2e run left its seed data (invoices, ratings …) behind.
const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

const at = (daysAgo: number, hour = 12) =>
  DateTime.now()
    .setZone(FRIDGE_TIMEZONE)
    .minus({ days: daysAgo })
    .set({ hour, minute: 0, second: 0, millisecond: 0 })

/** Days `from` down to `to` ago, one entry per day. */
const range = (from: number, to: number) =>
  Array.from({ length: from - to + 1 }, (_, index) => from - index)

async function lot(
  supplierId: number,
  productId: number,
  daysAgo: number,
  amount: number,
  options: { left?: number; price?: number; purchasePrice?: number | null } = {}
) {
  return Delivery.create({
    supplierId,
    productId,
    amountSupplied: amount,
    amountLeft: options.left ?? amount,
    amountLost: 0,
    price: options.price ?? 15,
    purchasePrice: options.purchasePrice ?? null,
    createdAt: at(daysAgo, 8),
  })
}

async function sell(deliveryId: number, buyerId: number, days: number[], price = 15) {
  if (days.length === 0) return
  await db.table('orders').multiInsert(
    days.map((daysAgo) => ({
      buyer_id: buyerId,
      delivery_id: deliveryId,
      channel: 'web',
      unit_price: price,
      created_at: at(daysAgo).toJSDate(),
      updated_at: at(daysAgo).toJSDate(),
    }))
  )
}

/**
 * One filler product selling every day, so every day of the window counts as a day the
 * fridge was in use — as in a real office.
 */
async function backgroundTraffic(buyer: User, categoryId: number) {
  const other = await UserFactory.apply('supplier').create()
  const filler = await ProductFactory.merge({ categoryId, displayName: 'Filler' }).create()
  const fillerLot = await lot(other.id, filler.id, 90, 300, { left: 300 - 84 })
  await sell(fillerLot.id, buyer.id, range(84, 1))
  return { other, filler }
}

/**
 * A staple: two lots of 24 at 14.90, one sale a day while in stock, sold out a few days
 * ago — about one piece per open day.
 */
async function staple(supplier: User, buyer: User, categoryId: number, name = 'Pepsi plech') {
  const product = await ProductFactory.merge({ categoryId, displayName: name }).create()
  const first = await lot(supplier.id, product.id, 60, 24, { left: 0, purchasePrice: 14.9 })
  await sell(first.id, buyer.id, range(59, 36))
  const second = await lot(supplier.id, product.id, 30, 24, { left: 0, purchasePrice: 14.9 })
  await sell(second.id, buyer.id, range(29, 6))
  return product
}

test.group('ShoppingListService — demand', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a sold-out staple is planned in whole packs at its purchase price', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    await backgroundTraffic(buyer, category.id)
    const product = await staple(supplier, buyer, category.id)

    const view = await service.getView(supplier)
    const line = view.lines.find((l) => l.key === `p-${product.id}`)

    assert.exists(line)
    assert.equal(view.settings.horizonDays, 14)
    assert.isTrue(view.settings.horizonIsAuto)
    assert.closeTo(view.openDaysInHorizon, 14, 0.01)
    assert.equal(line!.stock, 0)
    assert.include(line!.reasons, 'out_of_stock')
    assert.equal(line!.stockoutRisk, 1)
    assert.equal(line!.packSize, 24)
    // The hint names the lot sizes the pack was told from (P6).
    assert.deepEqual(line!.packSample, [24, 24])
    assert.equal(line!.suggestedQuantity, 24)
    assert.equal(line!.quantity, 24)
    assert.equal(line!.unitCost, 14.9)
    assert.equal(line!.costSource, 'purchase')
    assert.equal(line!.sellingPrice, 15)
    // ~0.93 a day: one sale a day while in stock, minus the prior and the two delivery days.
    assert.closeTo(line!.weeklyRate!, 6.5, 0.5)
    // The filler sold from one lot only — not a habit, so not planned on its own.
    assert.lengthOf(view.lines, 1)
    assert.equal(view.totals.pieces, 24)
    assert.equal(view.totals.cost, 357.6)
  })

  test('a longer horizon plans more', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    await backgroundTraffic(buyer, category.id)
    const product = await staple(supplier, buyer, category.id)

    await service.updateSettings(supplier.id, { horizonDays: 28 })
    const view = await service.getView(supplier)
    const line = view.lines.find((l) => l.key === `p-${product.id}`)!

    assert.equal(view.settings.horizonDays, 28)
    assert.isFalse(view.settings.horizonIsAuto)
    assert.equal(line.suggestedQuantity, 48)

    // A week needs ~10 pieces — less than half a pack, so it is not rounded up to 24.
    const week = await service.getView(supplier, { horizonDays: 7 })
    const weekly = week.lines.find((l) => l.key === `p-${product.id}`)!.suggestedQuantity
    assert.isAbove(weekly, 0)
    assert.isBelow(weekly, 24)
    // An override is not saved.
    const unchanged = await service.getView(supplier)
    assert.equal(unchanged.settings.horizonDays, 28)

    await service.updateSettings(supplier.id, { horizonDays: null })
    const automatic = await service.getView(supplier)
    assert.isTrue(automatic.settings.horizonIsAuto)
  })

  test('without purchase prices the cost is estimated from the selling price', async ({
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    await backgroundTraffic(buyer, category.id)
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const first = await lot(supplier.id, product.id, 40, 10, { left: 0, price: 17 })
    await sell(first.id, buyer.id, range(39, 30), 17)
    const second = await lot(supplier.id, product.id, 20, 10, { left: 0, price: 17 })
    await sell(second.id, buyer.id, range(19, 10), 17)

    const estimated = await service.getView(supplier)
    const line = estimated.lines.find((l) => l.key === `p-${product.id}`)!
    assert.equal(line.costSource, 'selling')
    assert.equal(line.unitCost, 17)
    assert.equal(line.sellingPrice, 17)
  })

  test('the default horizon follows the supplier’s shopping habit', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    for (const daysAgo of [35, 28, 21, 14, 7]) {
      await lot(supplier.id, product.id, daysAgo, 6)
    }

    const view = await service.getView(supplier)
    assert.equal(view.settings.autoHorizonDays, 7)
    assert.equal(view.settings.horizonDays, 7)
  })
})

test.group('ShoppingListService — archived products', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('an archived product is neither planned nor named as a hint (F6)', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    await backgroundTraffic(buyer, category.id)
    const pepsi = await staple(supplier, buyer, category.id)
    const energy = await ProductGroup.create({ name: 'Energy', categoryId: category.id })
    const monster = await ProductFactory.merge({
      categoryId: category.id,
      productGroupId: energy.id,
      displayName: 'Monster',
    }).create()
    const tiger = await ProductFactory.merge({
      categoryId: category.id,
      productGroupId: energy.id,
      displayName: 'Tiger',
    }).create()
    for (const member of [monster, tiger]) {
      const memberLot = await lot(supplier.id, member.id, 25, 12, { left: 0 })
      await sell(memberLot.id, buyer.id, range(24, 13))
    }

    const before = await service.getView(supplier)
    assert.exists(before.lines.find((l) => l.key === `p-${pepsi.id}`))
    const hintsBefore = before.lines.find((l) => l.key === `g-${energy.id}`)!.hints
    assert.sameMembers(
      hintsBefore.map((h) => h.name),
      ['Monster', 'Tiger']
    )

    for (const archived of [pepsi, tiger]) {
      archived.archivedAt = DateTime.now()
      await archived.save()
    }
    const after = await service.getView(supplier)
    const all = [...after.lines, ...after.covered]
    assert.notExists(all.find((l) => l.key === `p-${pepsi.id}`))
    const energyLine = all.find((l) => l.key === `g-${energy.id}`)!
    assert.deepEqual(
      energyLine.hints.map((h) => h.name),
      ['Monster']
    )
  })
})

test.group('ShoppingListService — private purchase prices', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a colleague’s purchase prices never price my list or my draft', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    await backgroundTraffic(buyer, category.id)
    // The colleague stocks the staple with a purchase price; I only add it to my list.
    const pepsi = await staple(colleague, buyer, category.id)
    await service.addLine(me.id, { productId: pepsi.id, quantity: 6 })

    const view = await service.getView(me)
    const line = view.lines.find((l) => l.key === `p-${pepsi.id}`)!
    assert.equal(line.costSource, 'selling')
    assert.equal(line.unitCost, 15)
    assert.isNull(line.goodPrice)

    const { draft } = await service.completeIntoDraft(me, { note: 'x', extrasNote: (i) => i })
    const [item] = await StockDraftItem.query().where('stockDraftId', draft.id)
    assert.isNull(item.purchasePrice)

    // With a purchase price of my own, only mine counts.
    await lot(me.id, pepsi.id, 2, 12, { left: 12, purchasePrice: 11.5 })
    const mine = await service.getView(me, { scope: 'all' })
    const own = [...mine.lines, ...mine.covered].find((l) => l.key === `p-${pepsi.id}`)!
    assert.equal(own.costSource, 'purchase')
    assert.equal(own.unitCost, 11.5)
  })
})

test.group('ShoppingListService — groups and scope', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a purchase group is one line; any member will do', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    await backgroundTraffic(buyer, category.id)
    const energy = await ProductGroup.create({ name: 'Energy s cukrem', categoryId: category.id })
    const mango = await ProductFactory.merge({
      categoryId: category.id,
      displayName: 'Monster Mango',
      productGroupId: energy.id,
    }).create()
    const ultra = await ProductFactory.merge({
      categoryId: category.id,
      displayName: 'Monster Ultra',
      productGroupId: energy.id,
    }).create()
    const mangoLot = await lot(supplier.id, mango.id, 25, 24, { left: 0, purchasePrice: 24.9 })
    await sell(mangoLot.id, buyer.id, range(24, 1))
    await lot(supplier.id, ultra.id, 25, 12, { left: 12, purchasePrice: 24.9 })

    const view = await service.getView(supplier)
    const line = view.lines.find((l) => l.key === `g-${energy.id}`)

    assert.exists(line)
    assert.equal(line!.kind, 'group')
    assert.equal(line!.stock, 12)
    assert.equal(line!.hints[0].name, 'Monster Mango')
    assert.isAbove(line!.suggestedQuantity, 0)
    // Members are not planned one by one.
    assert.isUndefined(view.lines.find((l) => l.key === `p-${mango.id}`))
    assert.isUndefined(view.lines.find((l) => l.key === `p-${ultra.id}`))

    // A customer's wish for one flavour counts towards the group.
    await service.addLine(supplier.id, { productId: ultra.id, quantity: 6 })
    const after = await service.getView(supplier)
    const wish = after.lines.find((l) => l.key === `p-${ultra.id}`)
    assert.exists(wish)
    assert.include(wish!.reasons, 'added')
    assert.equal(wish!.quantity, 6)
    assert.isBelow(
      after.lines.find((l) => l.key === `g-${energy.id}`)?.suggestedQuantity ?? 0,
      line!.suggestedQuantity
    )
  })

  test('"mine" lists only what the supplier stocks; "all" the whole fridge', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    await backgroundTraffic(buyer, category.id)
    const theirs = await staple(colleague, buyer, category.id, 'Kofola')

    const mine = await service.getView(me)
    assert.isUndefined(mine.lines.find((l) => l.key === `p-${theirs.id}`))

    await service.updateSettings(me.id, { scope: 'all' })
    const all = await service.getView(me)
    assert.exists(all.lines.find((l) => l.key === `p-${theirs.id}`))
  })

  test('the category filter narrows the plan', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const drinks = await CategoryFactory.create()
    const sweets = await CategoryFactory.create()
    await backgroundTraffic(buyer, drinks.id)
    const cola = await staple(supplier, buyer, drinks.id, 'Cola')
    const bar = await staple(supplier, buyer, sweets.id, 'Tyčinka')

    await service.updateSettings(supplier.id, { categoryIds: [sweets.id] })
    const view = await service.getView(supplier)
    assert.exists(view.lines.find((l) => l.key === `p-${bar.id}`))
    assert.isUndefined(view.lines.find((l) => l.key === `p-${cola.id}`))
  })
})

test.group('ShoppingListService — edits', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('overrides, ticks, dismissals and own lines survive recomputation', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    await backgroundTraffic(buyer, category.id)
    const product = await staple(supplier, buyer, category.id)
    const key = `p-${product.id}`

    await service.updateLine(supplier.id, key, { quantity: 5, isChecked: true, unitCost: 13.5 })
    let view = await service.getView(supplier)
    let line = view.lines.find((l) => l.key === key)!
    assert.equal(line.quantity, 5)
    assert.equal(line.suggestedQuantity, 24)
    assert.isTrue(line.isOverridden)
    assert.isTrue(line.isChecked)
    assert.equal(line.unitCost, 13.5)
    assert.equal(line.costSource, 'manual')
    assert.equal(line.lineTotal, 67.5)
    assert.equal(view.totals.checked, 1)

    await service.resetLine(supplier.id, key)
    view = await service.getView(supplier)
    line = view.lines.find((l) => l.key === key)!
    assert.equal(line.quantity, 24)
    assert.isFalse(line.isOverridden)

    await service.updateLine(supplier.id, key, { isRemoved: true })
    view = await service.getView(supplier)
    assert.isUndefined(view.lines.find((l) => l.key === key))
    assert.exists(view.removed.find((l) => l.key === key))

    const customKey = await service.addLine(supplier.id, {
      label: 'Kofola v akci',
      quantity: 3,
      unitCost: 19.9,
    })
    view = await service.getView(supplier)
    const custom = view.lines.find((l) => l.key === customKey)!
    assert.equal(custom.kind, 'custom')
    assert.equal(custom.name, 'Kofola v akci')
    assert.equal(custom.quantity, 3)
    assert.equal(custom.sellingPrice, 20)

    await service.resetLine(supplier.id, customKey)
    view = await service.getView(supplier)
    assert.isUndefined(view.lines.find((l) => l.key === customKey))
  })

  test('another supplier cannot touch my own line', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const other = await UserFactory.apply('supplier').create()
    const key = await service.addLine(me.id, { label: 'Moje', quantity: 1 })

    await assert.rejects(() => service.updateLine(other.id, key, { quantity: 9 }), 'LINE_NOT_FOUND')
    const view = await service.getView(me)
    assert.equal(view.lines.find((l) => l.key === key)!.quantity, 1)
  })

  test('line keys are parsed strictly', ({ assert }) => {
    assert.deepEqual(parseLineKey('g-12'), { kind: 'group', id: 12 })
    assert.deepEqual(parseLineKey('p-3'), { kind: 'product', id: 3 })
    assert.deepEqual(parseLineKey('c-7'), { kind: 'custom', id: 7 })
    assert.isNull(parseLineKey('x-1'))
    assert.isNull(parseLineKey('p-1; drop'))
    // Beyond a PostgreSQL integer — not found, never a database error.
    assert.isNull(parseLineKey('p-99999999999'))
  })
})

test.group('ShoppingListService — completing', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  const texts = {
    note: 'Nákupní seznam 3. 10. 2026',
    extrasNote: (items: string) => `Dále: ${items}`,
  }

  test('ticked lines become a draft; free-text lines go into its note', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    await backgroundTraffic(buyer, category.id)
    const pepsi = await staple(supplier, buyer, category.id)
    const energy = await ProductGroup.create({ name: 'Energy', categoryId: category.id })
    const monster = await ProductFactory.merge({
      categoryId: category.id,
      productGroupId: energy.id,
    }).create()
    const monsterLot = await lot(supplier.id, monster.id, 25, 24, { left: 0, purchasePrice: 24.9 })
    await sell(monsterLot.id, buyer.id, range(24, 1))
    const milk = await service.addLine(supplier.id, { label: 'Mléko do kávy', quantity: 2 })
    await service.addLine(supplier.id, { label: 'Banány', quantity: 3, unitCost: 9.9 })
    // Not ticked: stays off the draft.
    await service.updateLine(supplier.id, `p-${pepsi.id}`, { quantity: 6, isChecked: false })
    await service.updateLine(supplier.id, `g-${energy.id}`, { quantity: 12, isChecked: true })
    await service.updateLine(supplier.id, milk, { isChecked: true })

    const list = await service.findActive(supplier.id)
    const result = await service.completeIntoDraft(supplier, texts)

    assert.deepInclude(result, { lines: 1, pieces: 12, extras: 1 })
    const draft = await StockDraft.findOrFail(result.draft.id)
    assert.equal(draft.source, 'shopping_list')
    assert.equal(draft.note, 'Nákupní seznam 3. 10. 2026\nDále: Mléko do kávy 2×')
    const items = await StockDraftItem.query().where('stockDraftId', draft.id)
    assert.deepEqual(
      items.map((i) => [i.productId, i.productGroupId, i.label, i.amount, i.purchasePrice]),
      [[null, energy.id, 'Energy', 12, 24.9]]
    )
    const closed = await ShoppingList.findOrFail(list!.id)
    assert.equal(closed.status, 'done')
    assert.isNotNull(closed.completedAt)
    assert.isNull(await service.findActive(supplier.id))

    const audit = await db.from('audit_logs').where('action', 'shopping_list.completed').first()
    assert.equal(audit.user_id, supplier.id)
    assert.equal(audit.entity_id, list!.id)
    assert.deepEqual(audit.metadata, { lines: 1, pieces: 12, draftId: draft.id })
  })

  test('with nothing ticked, every line is bought', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    await backgroundTraffic(buyer, category.id)
    const pepsi = await staple(supplier, buyer, category.id)
    await service.addLine(supplier.id, { label: 'Banány', quantity: 3 })

    const result = await service.completeIntoDraft(supplier, texts)
    assert.deepInclude(result, { lines: 1, pieces: 24, extras: 1 })
    const [item] = await StockDraftItem.query().where('stockDraftId', result.draft.id)
    assert.deepEqual([item.productId, item.amount, item.purchasePrice], [pepsi.id, 24, 14.9])
    const draft = await StockDraft.findOrFail(result.draft.id)
    assert.include(draft.note, 'Dále: Banány 3×')
  })

  test('a line set to zero is not bought, even when ticked (QA-13)', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    await backgroundTraffic(buyer, category.id)
    const pepsi = await staple(supplier, buyer, category.id)
    const water = await ProductFactory.merge({ categoryId: category.id }).create()
    await service.addLine(supplier.id, { productId: water.id, quantity: 4 })
    await service.updateLine(supplier.id, `p-${pepsi.id}`, { quantity: 0, isChecked: true })
    await service.updateLine(supplier.id, `p-${water.id}`, { isChecked: true })

    const result = await service.completeIntoDraft(supplier, texts)
    const items = await StockDraftItem.query().where('stockDraftId', result.draft.id)
    assert.deepEqual(
      items.map((i) => [i.productId, i.amount]),
      [[water.id, 4]]
    )
  })

  test('free-text lines that do not fit the note are counted, not cut off (BE-18)', async ({
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    for (let i = 0; i < 30; i++) {
      await service.addLine(supplier.id, {
        label: `Položka číslo ${i} s delším názvem`,
        quantity: 1,
      })
    }
    const result = await service.completeIntoDraft(supplier, {
      ...texts,
      moreExtras: (count) => ` a další (${count})`,
    })
    const draft = await StockDraft.findOrFail(result.draft.id)
    assert.isAtMost(draft.note!.length, 500)
    assert.match(draft.note!, /, Položka číslo \d+ s delším názvem 1× a další \(\d+\)$/)
    assert.include(draft.note!, 'Položka číslo 0 s delším názvem 1×')
  })

  test('the next list starts with the settings of the last one (BE-08)', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    await service.updateSettings(supplier.id, {
      horizonDays: 30,
      scope: 'all',
      categoryIds: [category.id],
    })
    await service.addLine(supplier.id, { label: 'Banány', quantity: 3 })
    await service.completeIntoDraft(supplier, texts)

    // Shown before anything changed, and stored once something did.
    const shown = await service.getView(supplier)
    assert.deepInclude(shown.settings, {
      horizonDays: 30,
      horizonIsAuto: false,
      scope: 'all',
      categoryIds: [category.id],
    })
    assert.lengthOf(shown.lines, 0)
    await service.addLine(supplier.id, { label: 'Mléko', quantity: 1 })
    const active = await service.findActive(supplier.id)
    assert.deepInclude(
      { horizonDays: active!.horizonDays, scope: active!.scope, categoryIds: active!.categoryIds },
      { horizonDays: 30, scope: 'all', categoryIds: [category.id] }
    )
    // An assistant's "what if" still wins over the remembered settings.
    const week = await service.getView(supplier, { horizonDays: 7 })
    assert.equal(week.settings.horizonDays, 7)
  })

  test('an empty list cannot be completed, and a list only once', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    await assert.rejects(() => service.completeIntoDraft(supplier, texts), 'LIST_EMPTY')
    await service.updateSettings(supplier.id, { horizonDays: 7 })
    await assert.rejects(() => service.completeIntoDraft(supplier, texts), 'LIST_EMPTY')
    assert.lengthOf(await StockDraft.all(), 0)
    const untouched = await ShoppingList.query().firstOrFail()
    assert.equal(untouched.status, 'active')

    await service.addLine(supplier.id, { label: 'Banány', quantity: 3 })
    const results = await Promise.allSettled([
      service.completeIntoDraft(supplier, texts),
      service.completeIntoDraft(supplier, texts),
    ])
    // The list is locked while it is completed — the second attempt finds it done.
    assert.sameMembers(
      results.map((r) => r.status),
      ['fulfilled', 'rejected']
    )
    assert.lengthOf(await StockDraft.all(), 1)
  })

  test('the draft is not created when closing the list fails', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    await service.addLine(supplier.id, { label: 'Banány', quantity: 3 })
    const markDone = ShoppingListService.prototype.markDone
    ShoppingListService.prototype.markDone = async () => {
      throw new Error('boom')
    }
    try {
      await assert.rejects(() => service.completeIntoDraft(supplier, texts), 'boom')
    } finally {
      ShoppingListService.prototype.markDone = markDone
    }
    assert.lengthOf(await StockDraft.all(), 0)
    assert.lengthOf(await db.from('audit_logs').where('action', 'shopping_list.completed'), 0)
    const stillActive = await ShoppingList.query().firstOrFail()
    assert.equal(stillActive.status, 'active')
  })
})

test.group('ShoppingListService — concurrency', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('two tabs changing a new line at once end up with one row, fields merged', async ({
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await service.updateSettings(supplier.id, { horizonDays: 7 })
    const key = `p-${product.id}`

    const results = await Promise.allSettled([
      service.updateLine(supplier.id, key, { quantity: 5 }),
      service.updateLine(supplier.id, key, { isChecked: true }),
      service.updateLine(supplier.id, key, { note: 've slevě' }),
    ])
    for (const result of results) assert.equal(result.status, 'fulfilled')

    const rows = await ShoppingListItem.query().where('productId', product.id)
    assert.lengthOf(rows, 1)
    // Each edit writes only its own field, so none of them is lost (QA-12).
    assert.deepEqual([rows[0].quantity, rows[0].isChecked, rows[0].note], [5, true, 've slevě'])
    const view = await service.getView(supplier)
    assert.exists(view.lines.find((line) => line.key === key))
  })
})
