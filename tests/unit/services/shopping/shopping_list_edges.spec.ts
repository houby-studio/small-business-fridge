import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Delivery from '#models/delivery'
import ShoppingListItem from '#models/shopping_list_item'
import StockDraftItem from '#models/stock_draft_item'
import type User from '#models/user'
import { FRIDGE_TIMEZONE } from '#config/fridge'
import { LOOKBACK_DAYS } from '#services/shopping/demand_math'
import ShoppingListService from '#services/shopping/shopping_list_service'

/**
 * Edge cases of the shopping list: whose purchase prices it may use, which calendar day a
 * sale belongs to, and who may change a line.
 */

const service = new ShoppingListService()

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

const at = (daysAgo: number, hour = 12, minute = 0) =>
  DateTime.now()
    .setZone(FRIDGE_TIMEZONE)
    .minus({ days: daysAgo })
    .set({ hour, minute, second: 0, millisecond: 0 })

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
    price: options.price ?? 30,
    purchasePrice: options.purchasePrice ?? null,
    createdAt: at(daysAgo, 8),
  })
}

async function sellAt(deliveryId: number, buyerId: number, moments: DateTime[]) {
  if (moments.length === 0) return
  await db.table('orders').multiInsert(
    moments.map((moment) => ({
      buyer_id: buyerId,
      delivery_id: deliveryId,
      channel: 'web',
      unit_price: 30,
      created_at: moment.toJSDate(),
      updated_at: moment.toJSDate(),
    }))
  )
}

/**
 * A product a colleague keeps in stock — two lots of 24 paid 23.40 a piece, one sold a day
 * until a few days ago — so that it is on the list of anyone planning for the whole fridge.
 */
async function colleaguesStaple(colleague: User, buyer: User) {
  const category = await CategoryFactory.create()
  const product = await ProductFactory.merge({ categoryId: category.id }).create()
  const first = await lot(colleague.id, product.id, 60, 24, { left: 0, purchasePrice: 23.4 })
  await sellAt(
    first.id,
    buyer.id,
    range(59, 36).map((d) => at(d))
  )
  const second = await lot(colleague.id, product.id, 30, 24, { left: 0, purchasePrice: 23.4 })
  await sellAt(
    second.id,
    buyer.id,
    range(29, 6).map((d) => at(d))
  )
  return product
}

const texts = { note: 'Nákupní seznam', extrasNote: (items: string) => `Dále: ${items}` }

test.group('ShoppingListService — edges', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  // Decision 5 (PLAN.md): what a colleague paid is their business. The list estimates the
  // cost and the draft it turns into prefills purchase prices — both only from my own lots;
  // without any, the cost is estimated from the (public) selling price.
  // Mutation caught: pricing the line from every supplier's purchase prices.
  test("a colleague's purchase price never reaches my list or my draft", async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const product = await colleaguesStaple(colleague, buyer)
    await service.updateSettings(me.id, { scope: 'all' })

    const view = await service.getView(me)
    const line = view.lines.find((l) => l.key === `p-${product.id}`)
    assert.exists(line, 'the staple is on the whole-fridge list')
    assert.equal(line!.costSource, 'selling')
    assert.equal(line!.unitCost, 30)
    assert.notEqual(line!.goodPrice, 23.4)

    const result = await service.completeIntoDraft(me, texts)
    const [item] = await StockDraftItem.query().where('stockDraftId', result.draft.id)
    assert.equal(item.productId, product.id)
    assert.isNull(item.purchasePrice)
  })

  // Mutation caught: the same — my own 14.90 is outweighed by the colleague's bigger lots.
  test('with purchase prices of my own, only mine count', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const product = await colleaguesStaple(colleague, buyer)
    const mine = await lot(me.id, product.id, 90, 6, { left: 0, purchasePrice: 14.9 })
    await sellAt(
      mine.id,
      buyer.id,
      range(84, 79).map((d) => at(d))
    )

    const view = await service.getView(me)
    const line = view.lines.find((l) => l.key === `p-${product.id}`)
    assert.exists(line)
    assert.equal(line!.costSource, 'purchase')
    assert.equal(line!.unitCost, 14.9)
  })

  // A sale at 00:30 in Prague is that day's sale, though in UTC it is still the evening
  // before. Twelve weeks of sales only at 00:30 on today's weekday make today's weekday the
  // one day the fridge is in use: a one-day horizon expects exactly one open day.
  // Mutation caught: bucketing sales by the UTC date (`AT TIME ZONE` dropped or 'UTC').
  test("sales are counted on the fridge's calendar day, not the UTC one", async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const shelf = await lot(me.id, product.id, LOOKBACK_DAYS + 10, 100)
    const weeks = Array.from({ length: Math.floor(LOOKBACK_DAYS / 7) }, (_, i) => (i + 1) * 7)
    await sellAt(
      shelf.id,
      buyer.id,
      weeks.map((d) => at(d, 0, 30))
    )
    await db
      .from('deliveries')
      .where('id', shelf.id)
      .update({ amount_left: 100 - weeks.length })

    const view = await service.getView(me, { horizonDays: 1 })
    assert.equal(view.openDaysInHorizon, 1)
    // A week ahead holds that weekday once and no other open day.
    const week = await service.getView(me, { horizonDays: 7 })
    assert.equal(week.openDaysInHorizon, 1)
  })

  // Mutation caught: `resetLine` finding a custom line by its id alone, not within the
  // caller's own list.
  test('a colleague can neither change nor drop my own line', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const key = await service.addLine(me.id, { label: 'Mléko do kávy', quantity: 2, unitCost: 25 })

    // The colleague has a list of their own, so the lookup cannot stop at "no list".
    await service.addLine(colleague.id, { label: 'Banány', quantity: 1 })
    await assert.rejects(
      () => service.updateLine(colleague.id, key, { isChecked: true }),
      'LINE_NOT_FOUND'
    )
    await service.resetLine(colleague.id, key)

    const item = await ShoppingListItem.findOrFail(Number(key.slice(2)))
    assert.deepEqual(
      [item.label, item.quantity, item.unitCost, item.isChecked],
      ['Mléko do kávy', 2, 25, false]
    )
  })
})
