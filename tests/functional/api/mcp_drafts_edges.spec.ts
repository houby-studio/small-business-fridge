import '#tests/test_context'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { store as throttleStore } from '#middleware/throttle_middleware'
import Delivery from '#models/delivery'
import StockDraft from '#models/stock_draft'
import StockDraftItem from '#models/stock_draft_item'
import User from '#models/user'
import StockDraftService from '#services/shopping/stock_draft_service'
import ShoppingListService from '#services/shopping/shopping_list_service'
import NotificationService from '#services/notification_service'
import OrderService from '#services/order_service'
import DeliveryService from '#services/delivery_service'

/**
 * Stocking drafts and the shopping list from chat: another supplier's draft is out of
 * reach, a line patch changes only what it names, and what the assistant is told matches
 * what was saved.
 */

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

async function tokenFor(user: User) {
  const token = await User.accessTokens.create(user, ['*'], {
    name: 'test-mcp-token',
    expiresIn: '30 days',
  })
  return token.value!.release()
}

async function callTool(
  client: ApiClient,
  token: string,
  name: string,
  args: Record<string, unknown> = {}
) {
  const response = await client
    .post('/mcp')
    .header('Authorization', `Bearer ${token}`)
    .header('Accept', 'application/json, text/event-stream')
    .header('Content-Type', 'application/json')
    .json({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } })
  response.assertStatus(200)
  const text = response.text()
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'))
  const message = JSON.parse(line ? line.slice(5) : text)
  const content: string = message?.result?.content?.[0]?.text ?? ''
  let data: any = null
  try {
    data = JSON.parse(content)
  } catch {
    data = null
  }
  return { isError: message?.result?.isError === true, data, raw: content }
}

async function draftField(id: number, field: 'status' | 'note') {
  const draft = await StockDraft.findOrFail(id)
  return draft[field]
}

async function linesOf(draftId: number) {
  const items = await StockDraftItem.query()
    .where('stockDraftId', draftId)
    .orderBy('sortOrder', 'asc')
  return items.map((i) => [
    i.productId,
    i.label,
    i.amount,
    i.purchasePrice,
    i.purchasePriceEstimated,
    i.price,
  ])
}

async function product() {
  const category = await CategoryFactory.create()
  return ProductFactory.merge({ categoryId: category.id }).create()
}

test.group('API MCP — drafts and the shopping list, edges', (group) => {
  const sendRestockNotifications = NotificationService.prototype.sendRestockNotifications
  const notifyCorrection = DeliveryService.prototype.notifyCorrection
  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
    mail.fake()
    NotificationService.prototype.sendRestockNotifications = async () => {}
    DeliveryService.prototype.notifyCorrection = () => {}
  })
  group.each.teardown(async () => {
    NotificationService.prototype.sendRestockNotifications = sendRestockNotifications
    DeliveryService.prototype.notifyCorrection = notifyCorrection
    mail.restore()
    await cleanAll()
  })

  // Mutation caught: any draft tool skipping the owner check — an assistant of another
  // supplier rewriting, stocking or discarding my draft.
  test("another supplier's assistant cannot read, change, stock or discard my draft", async ({
    client,
    assert,
  }) => {
    const owner = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const pepsi = await product()
    const draft = await new StockDraftService().create(owner.id, {
      source: 'mcp',
      items: [{ productId: pepsi.id, amount: 24, purchasePrice: 14.9, price: 16 }],
    })
    const before = await linesOf(draft.id)
    const token = await tokenFor(colleague)
    const draftId = draft.id

    const calls: Array<[string, Record<string, unknown>]> = [
      ['get_stock_draft', { draftId }],
      ['update_stock_draft', { draftId, lines: [{ index: 0, amount: 1 }] }],
      ['update_stock_draft', { draftId, items: [{ productId: pepsi.id, amount: 1, price: 9 }] }],
      ['commit_stock_draft', { draftId, confirmWarnings: true }],
      ['discard_stock_draft', { draftId }],
    ]
    for (const [name, args] of calls) {
      const result = await callTool(client, token, name, args)
      assert.isTrue(result.isError, name)
      assert.include(result.raw, '(error code: DRAFT_NOT_FOUND)', name)
    }
    const listed = await callTool(client, token, 'list_stock_drafts')
    assert.deepEqual(listed.data.drafts, [])

    assert.deepEqual(await linesOf(draft.id), before)
    assert.equal(await draftField(draft.id, 'status'), 'open')
    assert.lengthOf(await Delivery.all(), 0)
  })

  // A receipt price typed in by the assistant is no estimate any more; changing only the
  // pieces keeps the shopping list's estimate flagged.
  // Mutations caught: the flag cleared by any patch, kept after a price patch, or a patch
  // touching fields it did not name.
  test('a line patch changes only what it names and settles an estimated price', async ({
    client,
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const [pepsi, cola] = [await product(), await product()]
    const draft = await new StockDraftService().create(me.id, {
      source: 'shopping_list',
      items: [
        { productId: pepsi.id, label: 'Pepsi', amount: 24, purchasePrice: 14.9 },
        { productId: cola.id, label: 'Cola', amount: 12, purchasePrice: 19.9 },
      ],
    })
    const token = await tokenFor(me)

    const patched = await callTool(client, token, 'update_stock_draft', {
      draftId: draft.id,
      lines: [
        { index: 0, purchasePrice: 13.9 },
        { index: 1, amount: 6 },
      ],
    })
    assert.isFalse(patched.isError, patched.raw)
    assert.deepEqual(await linesOf(draft.id), [
      [pepsi.id, 'Pepsi', 24, 13.9, false, null],
      [cola.id, 'Cola', 6, 19.9, true, null],
    ])
    assert.notProperty(patched.data.items[0], 'purchasePriceEstimated')
    assert.isTrue(patched.data.items[1].purchasePriceEstimated)

    // Unmatching a line that has no label would leave it nameless: refused, nothing saved.
    const nameless = await callTool(client, token, 'update_stock_draft', {
      draftId: draft.id,
      lines: [
        { index: 1, amount: 3 },
        { index: 0, productId: null, label: null },
      ],
    })
    assert.isTrue(nameless.isError)
    assert.include(nameless.raw, '(error code: VALIDATION)')
    assert.include(nameless.raw, 'Line 0')
    const negative = await callTool(client, token, 'update_stock_draft', {
      draftId: draft.id,
      lines: [{ index: -1, amount: 3 }],
    })
    assert.isTrue(negative.isError)
    assert.deepEqual(await linesOf(draft.id), [
      [pepsi.id, 'Pepsi', 24, 13.9, false, null],
      [cola.id, 'Cola', 6, 19.9, true, null],
    ])
  })

  // The assistant is told the note it saved. Today the tool's own hint takes the `note`
  // key, so the draft's note never reaches the assistant.
  test('update_stock_draft reports the note it saved', async ({ client, assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const pepsi = await product()
    const token = await tokenFor(me)
    const created = await callTool(client, token, 'create_stock_draft', {
      note: 'Lidl 2. 10.',
      items: [{ productId: pepsi.id, amount: 6, price: 15 }],
    })
    assert.include(JSON.stringify(created.data), 'Lidl 2. 10.')

    const updated = await callTool(client, token, 'update_stock_draft', {
      draftId: created.data.draftId,
      note: 'Lidl 2. 10., opraveno',
      lines: [{ index: 0, amount: 7 }],
    })
    assert.isFalse(updated.isError)
    assert.equal(await draftField(created.data.draftId, 'note'), 'Lidl 2. 10., opraveno')
    assert.include(JSON.stringify(updated.data), 'Lidl 2. 10., opraveno')
  })

  // Finishing the list from chat: only the ticked lines become the draft, and the free-text
  // things bought are named to the assistant (they are kept in the draft's note).
  test('complete_shopping_list drafts only the ticked lines and names the free-text ones', async ({
    client,
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const [pepsi, cola] = [await product(), await product()]
    const lists = new ShoppingListService()
    await lists.addLine(me.id, { productId: pepsi.id, quantity: 6 })
    await lists.addLine(me.id, { productId: cola.id, quantity: 12 })
    const milk = await lists.addLine(me.id, { label: 'Mléko do kávy', quantity: 2 })
    await lists.updateLine(me.id, `p-${pepsi.id}`, { isChecked: true })
    await lists.updateLine(me.id, milk, { isChecked: true })
    const token = await tokenFor(me)

    const completed = await callTool(client, token, 'complete_shopping_list')
    assert.isFalse(completed.isError, completed.raw)
    assert.deepEqual(
      completed.data.items.map((i: any) => [i.productId, i.amount]),
      [[pepsi.id, 6]]
    )
    assert.equal(completed.data.freeTextLines, 1)
    const draft = await StockDraft.findOrFail(completed.data.draftId)
    assert.include(draft.note, 'Mléko do kávy 2×')
    assert.include(JSON.stringify(completed.data), 'Mléko do kávy 2×')
  })

  // Decision 5 over MCP: a colleague's purchase price is hidden, my own and the selling
  // prices are shown; an admin sees everything.
  // Mutation caught: `canSeePurchasePrice` letting anyone see every lot's cost.
  test('recent_deliveries scope all hides what colleagues paid, not from an admin', async ({
    client,
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const pepsi = await product()
    const make = (supplierId: number, price: number, purchasePrice: number, hours: number) =>
      Delivery.create({
        supplierId,
        productId: pepsi.id,
        amountSupplied: 10,
        amountLeft: 10,
        amountLost: 0,
        price,
        purchasePrice,
        createdAt: DateTime.now().minus({ hours }),
      })
    const mine = await make(me.id, 18, 12.5, 2)
    const theirs = await make(colleague.id, 19, 9.9, 1)

    const seen = async (user: User) => {
      const result = await callTool(client, await tokenFor(user), 'recent_deliveries', {
        scope: 'all',
      })
      return new Map(
        result.data.deliveries.map((d: any) => [d.deliveryId, [d.price, d.purchasePrice]])
      )
    }
    const forMe = await seen(me)
    assert.deepEqual(forMe.get(mine.id), [18, 12.5])
    assert.deepEqual(forMe.get(theirs.id), [19, null])
    const forAdmin = await seen(admin)
    assert.deepEqual(forAdmin.get(mine.id), [18, 12.5])
    assert.deepEqual(forAdmin.get(theirs.id), [19, 9.9])
  })

  // F3 from chat: the stocked list is my own, canVoid follows the lots, and a void needs an
  // untouched draft of mine.
  // Mutations caught: no owner check in void_stock_draft, listing a colleague's drafts.
  test('stocked drafts are listed and voided only by their owner, only while untouched', async ({
    client,
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const pepsi = await product()
    const drafts = new StockDraftService()
    const stock = async (owner: User) => {
      const draft = await drafts.create(owner.id, {
        source: 'mcp',
        items: [{ productId: pepsi.id, amount: 6, price: 20 }],
      })
      const { deliveries } = await drafts.commit(owner, draft.id, { confirmWarnings: true })
      return { draftId: draft.id, lotId: deliveries[0].id }
    }
    const first = await stock(me)
    const second = await stock(me)
    await stock(colleague)
    await new OrderService().purchase(buyer.id, first.lotId, 'web')
    const [withSale, clean] = [first, second]
    const token = await tokenFor(me)

    const listed = await callTool(client, token, 'list_stock_drafts', { status: 'committed' })
    const byId = new Map(listed.data.drafts.map((d: any) => [d.draftId, d]))
    assert.sameMembers([...byId.keys()], [withSale.draftId, clean.draftId])
    assert.isTrue((byId.get(clean.draftId) as any).canVoid)
    assert.notEqual((byId.get(withSale.draftId) as any).canVoid, true)

    const foreign = await callTool(client, await tokenFor(colleague), 'void_stock_draft', {
      draftId: clean.draftId,
      reason: 'Cizí příjemka',
    })
    assert.include(foreign.raw, '(error code: DRAFT_NOT_FOUND)')
    const blocked = await callTool(client, token, 'void_stock_draft', {
      draftId: withSale.draftId,
      reason: 'Omyl',
    })
    assert.include(blocked.raw, '(error code: DRAFT_HAS_SALES)')
    const voided = await callTool(client, token, 'void_stock_draft', {
      draftId: clean.draftId,
      reason: 'Naskladněno dvakrát',
    })
    assert.isFalse(voided.isError, voided.raw)
    assert.equal(voided.data.voidedDeliveries, 1)
    const lot = await Delivery.findOrFail(clean.lotId)
    assert.isNotNull(lot.voidedAt)
    assert.equal(await draftField(clean.draftId, 'status'), 'voided')
  })
})
