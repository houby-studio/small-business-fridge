import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Delivery from '#models/delivery'
import Product from '#models/product'
import ShoppingList from '#models/shopping_list'
import ShoppingListItem from '#models/shopping_list_item'
import StockDraft from '#models/stock_draft'
import StockDraftItem from '#models/stock_draft_item'
import ProductGroup from '#models/product_group'
import type User from '#models/user'
import StockDraftService, { draftVersion } from '#services/shopping/stock_draft_service'
import ShoppingListService from '#services/shopping/shopping_list_service'
import NotificationService from '#services/notification_service'
import DeliveryService from '#services/delivery_service'

/**
 * Stocking drafts and the shopping list over HTTP: who may touch what, what a refused save
 * tells the page, and which purchase prices a supplier gets to see.
 */

const inertia = { 'x-inertia': 'true', 'x-inertia-version': '1' }
const drafts = new StockDraftService()

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

async function product(name?: string) {
  const category = await CategoryFactory.create()
  return ProductFactory.merge({
    categoryId: category.id,
    ...(name && { displayName: name }),
  }).create()
}

async function lot(
  supplierId: number,
  productId: number,
  price: number,
  purchasePrice: number | null,
  minutesAgo = 120
) {
  return Delivery.create({
    supplierId,
    productId,
    amountSupplied: 10,
    amountLeft: 10,
    amountLost: 0,
    price,
    purchasePrice,
    createdAt: DateTime.now().minus({ minutes: minutesAgo }),
  })
}

async function draftField(id: number, field: 'status' | 'note') {
  const draft = await StockDraft.findOrFail(id)
  return draft[field]
}

async function linesOf(draftId: number) {
  const items = await StockDraftItem.query()
    .where('stockDraftId', draftId)
    .orderBy('sortOrder', 'asc')
  return items.map((i) => [i.productId, i.label, i.amount, i.purchasePrice, i.price])
}

/** A PUT/POST as the page sends it, followed back to the page so flash and errors show. */
function send(
  client: any,
  method: 'put' | 'post' | 'delete',
  url: string,
  user: User,
  body: Record<string, unknown> = {},
  referer = '/supplier/stock'
) {
  return client[method](url)
    .loginAs(user)
    .withCsrfToken()
    .headers(inertia)
    .header('referer', referer)
    .json(body)
    .redirects(1)
}

test.group('Web stocking drafts — edges', (group) => {
  const sendRestockNotifications = NotificationService.prototype.sendRestockNotifications
  group.each.setup(async () => {
    await cleanAll()
    mail.fake()
    NotificationService.prototype.sendRestockNotifications = async () => {}
  })
  group.each.teardown(async () => {
    NotificationService.prototype.sendRestockNotifications = sendRestockNotifications
    mail.restore()
    await cleanAll()
  })

  // Mutations caught: an owner check missing on the PUT (autosave), the commit, or the
  // "new product from a draft line" path of the product form.
  test('a colleague can neither save, stock nor fill my draft over the web', async ({
    client,
    assert,
  }) => {
    const owner = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const pepsi = await product()
    const draft = await drafts.create(owner.id, {
      source: 'mcp',
      items: [{ label: 'PEPSI 0,33', amount: 24, purchasePrice: 14.9 }],
    })
    const before = await linesOf(draft.id)
    const url = `/supplier/stock/drafts/${draft.id}`

    const saved = await send(client, 'put', url, colleague, {
      items: [{ productId: pepsi.id, amount: 99, price: 10 }],
    })
    assert.equal(saved.body().props.flash.alert.type, 'danger')
    assert.equal(saved.body().props.flash.draftSaveError, 'DRAFT_NOT_FOUND')

    const stocked = await send(client, 'post', `${url}/commit`, colleague, {
      items: [{ productId: pepsi.id, amount: 99, price: 10 }],
      confirmWarnings: true,
    })
    assert.equal(stocked.body().props.flash.alert.type, 'danger')

    const created = await client
      .post('/supplier/products')
      .loginAs(colleague)
      .withCsrfToken()
      .field('displayName', 'Pepsi od kolegy')
      .field('categoryId', pepsi.categoryId)
      .field('allergenIds', JSON.stringify([]))
      .field('draftId', draft.id)
      .field('lineIndex', 0)
      .redirects(0)
    created.assertStatus(302)
    const newProduct = await Product.findByOrFail('displayName', 'Pepsi od kolegy')
    // The product still lands somewhere sensible: the colleague's own draft.
    const location = created.header('location')!
    const target = Number(location.match(/^\/supplier\/stock\/drafts\/(\d+)\?focus=\d+$/)![1])
    assert.notEqual(target, draft.id)
    const theirs = await StockDraft.findOrFail(target)
    assert.equal(theirs.supplierId, colleague.id)
    assert.deepEqual(await linesOf(target), [[newProduct.id, null, 1, null, null]])

    assert.deepEqual(await linesOf(draft.id), before)
    assert.equal(await draftField(draft.id, 'status'), 'open')
    assert.lengthOf(await Delivery.all(), 0)
  })

  // Mutations caught: the list or the shared badge counting drafts of every supplier.
  // PLAN4 P7: "Naskladnění" opens my one open draft; the badge and the stock page's chip
  // count only my lines.
  // Mutations caught: the redirect, the badge or the chip reading a colleague's draft.
  test("Naskladnění, the badge and the chip never show a colleague's draft", async ({
    client,
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const newcomer = await UserFactory.apply('supplier').create()
    const pepsi = await product()
    const mine = await drafts.create(me.id, {
      source: 'web',
      items: [{ productId: pepsi.id, amount: 2, price: 10 }],
    })
    await drafts.create(colleague.id, {
      source: 'mcp',
      items: [
        { productId: pepsi.id, amount: 5, price: 10 },
        { label: 'Cola', amount: 7 },
      ],
    })

    const opened = await client.get('/supplier/stock/drafts').loginAs(me).redirects(0)
    assert.equal(opened.header('location'), `/supplier/stock/drafts/${mine.id}`)
    const none = await client.get('/supplier/stock/drafts').loginAs(newcomer).redirects(0)
    assert.equal(none.header('location'), '/supplier/stock')

    const stock = await client.get('/supplier/stock').loginAs(me).headers(inertia)
    assert.equal(stock.body().props.openDraftCount, 1)
    assert.deepEqual(stock.body().props.openDraft, { id: mine.id, lines: 1, pieces: 2 })
    const theirs = await client.get('/supplier/stock').loginAs(newcomer).headers(inertia)
    assert.equal(theirs.body().props.openDraftCount, 0)
    assert.isNull(theirs.body().props.openDraft)
  })

  // Decision 3 and 5: the page suggests prices with the owner's margin and shows the owner's
  // own last purchase prices — also to an admin reviewing the draft.
  // Mutations caught: the viewer's margin or the viewer's purchase prices on the page.
  test("an admin reviewing a supplier's draft sees the owner's margin and prices", async ({
    client,
    assert,
  }) => {
    const owner = await UserFactory.apply('supplier').create()
    owner.marginPercent = 10
    await owner.save()
    const admin = await UserFactory.apply('admin').create()
    admin.marginPercent = 40
    await admin.save()
    const pepsi = await product()
    await lot(owner.id, pepsi.id, 18, 12.5, 300)
    await lot(admin.id, pepsi.id, 20, 9.9, 60)
    const draft = await drafts.create(owner.id, {
      source: 'mcp',
      items: [{ productId: pepsi.id, amount: 6 }],
    })

    const page = await client
      .get(`/supplier/stock/drafts/${draft.id}`)
      .loginAs(admin)
      .headers(inertia)
    page.assertStatus(200)
    const { marginPercent, products } = page.body().props
    assert.equal(marginPercent, 10)
    const entry = products.find((p: any) => p.id === pepsi.id)
    // The newest lot is the admin's: its selling price is public, its purchase price is not.
    assert.deepEqual([entry.lastPrice, entry.lastPurchasePrice], [20, 12.5])
  })

  // Decision 5: a colleague's purchase price is never offered to me, their selling price is.
  // Mutation caught: `lastPrices` reading the purchase price from anyone's newest lot.
  test('the draft page offers my own purchase prices only', async ({ client, assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const both = await product()
    const theirsOnly = await product()
    await lot(me.id, both.id, 15, 12.5, 300)
    await lot(colleague.id, both.id, 19, 9.9, 60)
    await lot(colleague.id, theirsOnly.id, 25, 21.3, 60)
    const draft = await drafts.findOrCreateOpenDraft(me.id)

    const page = await client.get(`/supplier/stock/drafts/${draft.id}`).loginAs(me).headers(inertia)
    const byId = new Map(page.body().props.products.map((p: any) => [p.id, p]))
    assert.deepInclude(byId.get(both.id), { lastPrice: 19, lastPurchasePrice: 12.5 })
    assert.deepInclude(byId.get(theirsOnly.id), { lastPrice: 25, lastPurchasePrice: null })
    assert.notInclude(JSON.stringify(page.body().props.products), '21.3')
    assert.notInclude(JSON.stringify(page.body().props.products), '9.9')
  })

  // QA-03: a refused save must reach the page as a failure — the redirect back is a
  // success to Inertia, so the page reads `draftSaveError`.
  // Mutations caught: swallowing the code, a stale or closed save reported as saved,
  // or the stale save overwriting the newer lines.
  test('a save over a stocked or newer draft is refused and says why', async ({
    client,
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const pepsi = await product()
    const draft = await drafts.create(me.id, {
      source: 'mcp',
      items: [{ productId: pepsi.id, amount: 6, price: 15 }],
    })
    const url = `/supplier/stock/drafts/${draft.id}`
    const loaded = draftVersion(await drafts.get(me, draft.id))

    // An assistant changes the draft after the page loaded it.
    await drafts.update(me, draft.id, { items: [{ productId: pepsi.id, amount: 12, price: 15 }] })
    const stale = await send(
      client,
      'put',
      url,
      me,
      { version: loaded, items: [{ productId: pepsi.id, amount: 7, price: 15 }] },
      url
    )
    assert.equal(stale.body().props.flash.draftSaveError, 'DRAFT_STALE')
    assert.equal(stale.body().props.flash.alert.type, 'warn')
    // The page is back on the draft with the newer lines and their version.
    assert.equal(stale.body().props.draft.items[0].amount, 12)
    assert.notEqual(stale.body().props.draft.version, loaded)
    assert.deepEqual(await linesOf(draft.id), [[pepsi.id, null, 12, null, 15]])

    const current = stale.body().props.draft.version
    const fine = await send(
      client,
      'put',
      url,
      me,
      { version: current, items: [{ productId: pepsi.id, amount: 8, price: 15 }] },
      url
    )
    assert.notProperty(fine.body().props.flash, 'draftSaveError')
    assert.notProperty(fine.body().props.flash, 'alert')
    assert.deepEqual(await linesOf(draft.id), [[pepsi.id, null, 8, null, 15]])

    await drafts.commit(me, draft.id, { confirmWarnings: true })
    const closed = await send(
      client,
      'put',
      url,
      me,
      { items: [{ productId: pepsi.id, amount: 99, price: 15 }] },
      url
    )
    assert.equal(closed.body().props.flash.draftSaveError, 'DRAFT_CLOSED')
    assert.equal(closed.body().props.flash.alert.type, 'danger')
    assert.deepEqual(await linesOf(draft.id), [[pepsi.id, null, 8, null, 15]])
    assert.lengthOf(await Delivery.all(), 1)
  })

  // Mutation caught: the item limit of the validator off by one or missing.
  // 200 is the documented limit (PLAN F-S6), written out so a changed constant shows up here.
  const MAX_LINES = 200
  test(`a draft holds at most ${MAX_LINES} lines`, async ({ client, assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const draft = await drafts.create(me.id, { source: 'web', items: [] })
    const url = `/supplier/stock/drafts/${draft.id}`
    const lines = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ label: `Řádek ${i}`, amount: 1 }))

    const tooMany = await send(client, 'put', url, me, { items: lines(MAX_LINES + 1) }, url)
    assert.property(tooMany.body().props.errors, 'items')
    assert.lengthOf(await StockDraftItem.all(), 0)

    const full = await send(client, 'put', url, me, { items: lines(MAX_LINES) }, url)
    assert.deepEqual(full.body().props.errors, {})
    assert.lengthOf(await StockDraftItem.all(), MAX_LINES)
  })

  // F-V1: a refused line is a validation error on its field, not a silent "nothing happened".
  // Mutations caught: dropping `decimal([0, 2])`, `withoutDecimals()` or `min(1)`.
  const invalid: Array<[string, Record<string, unknown>, string]> = [
    ['a purchase price with tenths of a cent', { purchasePrice: 14.999 }, 'purchasePrice'],
    ['a selling price with hellers', { price: 14.5 }, 'price'],
    ['zero pieces', { amount: 0 }, 'amount'],
    ['a fraction of a piece', { amount: 1.5 }, 'amount'],
    ['a negative purchase price', { purchasePrice: -1 }, 'purchasePrice'],
  ]
  for (const [name, patch, field] of invalid) {
    test(`a line with ${name} is refused with an error on ${field}`, async ({ client, assert }) => {
      const me = await UserFactory.apply('supplier').create()
      const pepsi = await product()
      const draft = await drafts.create(me.id, {
        source: 'web',
        items: [{ productId: pepsi.id, amount: 6, price: 15 }],
      })
      const url = `/supplier/stock/drafts/${draft.id}`
      const response = await send(
        client,
        'put',
        url,
        me,
        { items: [{ productId: pepsi.id, amount: 6, price: 15, ...patch }] },
        url
      )
      assert.include(Object.keys(response.body().props.errors), `items.0.${field}`)
      assert.deepEqual(await linesOf(draft.id), [[pepsi.id, null, 6, null, 15]])
    })
  }

  // F6: an archived product is no longer bought, so the picker does not offer it — but a
  // line that already names it must still show its name.
  // Mutation caught: the draft page listing the whole catalogue.
  test('the product picker leaves out archived products unless a line uses one', async ({
    client,
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const active = await product('Aktivní')
    const archived = await product('Archivovaný')
    const archivedInLine = await product('Archivovaný v řádku')
    await db
      .from('products')
      .whereIn('id', [archived.id, archivedInLine.id])
      .update({ archived_at: new Date() })
    const draft = await drafts.create(me.id, {
      source: 'mcp',
      items: [{ productId: archivedInLine.id, amount: 1, price: 10 }],
    })

    const page = await client.get(`/supplier/stock/drafts/${draft.id}`).loginAs(me).headers(inertia)
    const ids = page.body().props.products.map((p: any) => p.id)
    assert.include(ids, active.id)
    assert.include(ids, archivedInLine.id)
    assert.notInclude(ids, archived.id)
  })
})

test.group('Web supplier mutations — role gates and strangers', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  // F-R1: every write in the drafts and shopping-list section is supplier-only.
  // Mutation caught: a route moved out of the group guarded by the role middleware.
  test('a customer changes nothing in drafts, the shopping list or groups', async ({
    client,
    assert,
  }) => {
    const owner = await UserFactory.apply('supplier').create()
    const customer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const pepsi = await ProductFactory.merge({ categoryId: category.id }).create()
    const draft = await drafts.create(owner.id, {
      source: 'web',
      items: [{ productId: pepsi.id, amount: 6, price: 15 }],
    })
    const key = await new ShoppingListService().addLine(owner.id, { label: 'Mléko', quantity: 2 })
    const before = await linesOf(draft.id)

    const attempts: Array<['put' | 'post' | 'delete', string, Record<string, unknown>]> = [
      ['post', '/supplier/stock/drafts', { productId: pepsi.id }],
      ['put', `/supplier/stock/drafts/${draft.id}`, { items: [] }],
      ['post', `/supplier/stock/drafts/${draft.id}/commit`, { items: [], confirmWarnings: true }],
      ['delete', `/supplier/stock/drafts/${draft.id}`, {}],
      ['put', '/supplier/shopping-list', { horizonDays: 7 }],
      ['post', '/supplier/shopping-list/lines', { label: 'Pivo', quantity: 24 }],
      ['put', `/supplier/shopping-list/lines/${key}`, { quantity: 9 }],
      ['delete', `/supplier/shopping-list/lines/${key}`, {}],
      ['post', '/supplier/shopping-list/complete', {}],
      ['post', '/supplier/product-groups', { name: 'Cola', categoryId: category.id }],
    ]
    for (const [method, url, body] of attempts) {
      const response = await client[method](url)
        .loginAs(customer)
        .withCsrfToken()
        .json(body)
        .redirects(0)
      assert.equal(response.status(), 302, `${method} ${url}`)
      assert.equal(response.header('location'), '/', `${method} ${url}`)
    }

    assert.deepEqual(await linesOf(draft.id), before)
    assert.equal(await draftField(draft.id, 'status'), 'open')
    assert.lengthOf(await StockDraft.query().where('supplierId', customer.id), 0)
    assert.lengthOf(await ShoppingList.query().where('supplierId', customer.id), 0)
    assert.lengthOf(await ShoppingList.query().where('status', 'done'), 0)
    assert.lengthOf(await ProductGroup.all(), 0)
    const own = await ShoppingListItem.findOrFail(Number(key.slice(2)))
    assert.deepEqual([own.quantity, own.label], [2, 'Mléko'])
  })

  // F-L1: a line key is guessable; it only ever addresses the caller's own list.
  // Mutation caught: looking a free-text line up by its id alone.
  test('a colleague can neither change nor drop my own shopping-list line', async ({
    client,
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const lists = new ShoppingListService()
    const key = await lists.addLine(me.id, { label: 'Mléko do kávy', quantity: 2 })
    await lists.addLine(colleague.id, { label: 'Banány', quantity: 1 })

    const changed = await send(
      client,
      'put',
      `/supplier/shopping-list/lines/${key}`,
      colleague,
      { quantity: 9, isChecked: true },
      '/supplier/shopping-list'
    )
    assert.equal(changed.body().props.flash.alert.type, 'danger')
    await send(
      client,
      'delete',
      `/supplier/shopping-list/lines/${key}`,
      colleague,
      {},
      '/supplier/shopping-list'
    )

    const mine = await ShoppingListItem.findOrFail(Number(key.slice(2)))
    assert.deepEqual([mine.quantity, mine.isChecked, mine.label], [2, false, 'Mléko do kávy'])
  })
})

test.group('Web stock history — sorting, paging and privacy', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  // F-H1: sorting and paging happen on the server, over a whitelist.
  // Mutations caught: paging before sorting, an ignored sort order, a field outside the
  // whitelist reaching ORDER BY, or the "mine" filter dropped.
  test('history sorts and pages on the server and ignores unknown sort fields', async ({
    client,
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const pepsi = await product()
    // 25 lots priced 1–25 CZK, stocked in an order unrelated to the price.
    const prices = Array.from({ length: 25 }, (_, i) => ((i * 7) % 25) + 1)
    for (const [index, price] of prices.entries()) {
      await lot(me.id, pepsi.id, price, null, 1000 - index * 10)
    }
    await lot(colleague.id, pepsi.id, 99, null, 5)

    const page = async (qs: Record<string, unknown>) => {
      const response = await client
        .get('/supplier/deliveries')
        .qs({ scope: 'mine', ...qs })
        .loginAs(me)
        .headers(inertia)
      response.assertStatus(200)
      return response.body().props.recentDeliveries
    }

    const second = await page({ sortBy: 'price', sortOrder: 'asc', page: 2 })
    assert.deepEqual(
      second.data.map((d: any) => d.price),
      [21, 22, 23, 24, 25]
    )
    assert.equal(second.meta.total, 25)
    const cheapestFirst = await page({ sortBy: 'price', sortOrder: 'desc' })
    assert.equal(cheapestFirst.data[0].price, 25)

    // An unknown field falls back to the stocking time (here oldest first, as asked);
    // without any sort the newest lot comes first.
    const evil = await page({ sortBy: 'price; DROP TABLE deliveries', sortOrder: 'asc' })
    assert.deepEqual(
      evil.data.map((d: any) => d.price),
      prices.slice(0, 20)
    )
    const plain = await page({})
    assert.deepEqual(
      plain.data.map((d: any) => d.price),
      [...prices].reverse().slice(0, 20)
    )
  })

  // Decision 5: a colleague's purchase price is hidden in the shared history; an admin sees it.
  // Mutation caught: `canSeePurchasePrice` returning true for anyone.
  test('the shared history hides what colleagues paid, except from an admin', async ({
    client,
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const pepsi = await product()
    const mine = await lot(me.id, pepsi.id, 18, 12.5)
    const theirs = await lot(colleague.id, pepsi.id, 19, 9.9)

    const seen = async (user: User) => {
      const response = await client
        .get('/supplier/deliveries')
        .qs({ scope: 'all' })
        .loginAs(user)
        .headers(inertia)
      return new Map(
        response
          .body()
          .props.recentDeliveries.data.map((d: any) => [d.id, [d.price, d.purchasePrice]])
      )
    }
    const forMe = await seen(me)
    assert.deepEqual(forMe.get(mine.id), [18, 12.5])
    assert.deepEqual(forMe.get(theirs.id), [19, null])
    const forAdmin = await seen(admin)
    assert.deepEqual(forAdmin.get(theirs.id), [19, 9.9])
  })
})

test.group('Web stocked drafts — history and void (F3)', (group) => {
  const sendRestockNotifications = NotificationService.prototype.sendRestockNotifications
  const notifyCorrection = DeliveryService.prototype.notifyCorrection
  group.each.setup(async () => {
    await cleanAll()
    NotificationService.prototype.sendRestockNotifications = async () => {}
    DeliveryService.prototype.notifyCorrection = () => {}
  })
  group.each.teardown(async () => {
    NotificationService.prototype.sendRestockNotifications = sendRestockNotifications
    DeliveryService.prototype.notifyCorrection = notifyCorrection
    await cleanAll()
  })

  async function stockedDraft(owner: User, productId: number) {
    const draft = await drafts.create(owner.id, {
      source: 'web',
      items: [{ productId, amount: 6, price: 20, purchasePrice: 12.5 }],
    })
    const { deliveries } = await drafts.commit(owner, draft.id, { confirmWarnings: true })
    return { draft, lot: deliveries[0] }
  }

  // Mutations caught: no owner check on the void route, a reason not validated, the
  // stocked list or the history link showing a colleague's draft.
  test('only the owner voids a stocked draft, with a reason, and only they see it listed', async ({
    client,
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const pepsi = await product()
    const { draft, lot: stockedLot } = await stockedDraft(me, pepsi.id)
    const url = `/supplier/stock/drafts/${draft.id}/void`

    const foreign = await send(client, 'post', url, colleague, { reason: 'Cizí příjemka' })
    assert.equal(foreign.body().props.flash.alert.type, 'danger')
    const short = await send(client, 'post', url, me, { reason: ' x ' })
    assert.include(Object.keys(short.body().props.errors), 'reason')
    assert.equal(await draftField(draft.id, 'status'), 'committed')
    const untouched = await Delivery.findOrFail(stockedLot.id)
    assert.isNull(untouched.voidedAt)

    const history = async (user: User) => {
      const response = await client
        .get('/supplier/deliveries')
        .qs({ scope: 'all' })
        .loginAs(user)
        .headers(inertia)
      const row = response
        .body()
        .props.recentDeliveries.data.find((d: any) => d.id === stockedLot.id)
      return row.stockDraftId
    }
    assert.equal(await history(me), draft.id)
    assert.isNull(await history(colleague))
    assert.equal(await history(admin), draft.id)

    const done = await send(client, 'post', url, me, { reason: 'Naskladněno dvakrát' })
    assert.equal(done.body().props.flash.alert.type, 'success')
    assert.equal(await draftField(draft.id, 'status'), 'voided')
  })

  // A refused void is a message on the page, whatever the reason — never a server error.
  test('voiding a draft whose stock was handed over is refused with a message', async ({
    client,
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const pepsi = await product()
    const { draft } = await stockedDraft(me, pepsi.id)
    await new DeliveryService().transferStock(me.id, colleague.id, admin)

    const response = await send(client, 'post', `/supplier/stock/drafts/${draft.id}/void`, me, {
      reason: 'Omyl',
    })
    response.assertStatus(200)
    assert.equal(response.body().props.flash.alert.type, 'danger')
    assert.equal(response.body().props.flash.draftSaveError, 'DRAFT_TRANSFERRED')
    assert.equal(await draftField(draft.id, 'status'), 'committed')
  })
})

test.group('Web history of stocked drafts (type=drafts)', (group) => {
  const sendRestockNotifications = NotificationService.prototype.sendRestockNotifications
  const notifyCorrection = DeliveryService.prototype.notifyCorrection
  group.each.setup(async () => {
    await cleanAll()
    NotificationService.prototype.sendRestockNotifications = async () => {}
    DeliveryService.prototype.notifyCorrection = () => {}
  })
  group.each.teardown(async () => {
    NotificationService.prototype.sendRestockNotifications = sendRestockNotifications
    DeliveryService.prototype.notifyCorrection = notifyCorrection
    await cleanAll()
  })

  async function stock(owner: User, items: Array<Record<string, unknown>>) {
    const draft = await drafts.create(owner.id, { source: 'web', items: items as any })
    await drafts.commit(owner, draft.id, { confirmWarnings: true })
    return draft.id
  }

  async function history(client: any, user: User, qs: Record<string, unknown> = {}) {
    const response = await client
      .get('/supplier/deliveries')
      .qs({ type: 'drafts', ...qs })
      .loginAs(user)
      .headers(inertia)
    response.assertStatus(200)
    return response.body().props.drafts
  }

  // Decision 5 again: a colleague's draft shows who stocked how much, not what they paid,
  // and it is never theirs to void. An admin sees everything.
  // Mutations caught: purchase totals or canVoid computed for every row, the "mine" filter
  // dropped, open or discarded drafts listed.
  test("a colleague's stocked draft shows its size, not what was paid", async ({
    client,
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const pepsi = await product()
    const line = { productId: pepsi.id, price: 20 }
    const mine = await stock(me, [{ ...line, amount: 24, purchasePrice: 14.9 }])
    const theirs = await stock(colleague, [
      { ...line, amount: 10, purchasePrice: 21.3 },
      { ...line, amount: 2 },
    ])
    // Neither an open nor a discarded draft is history.
    await drafts.create(me.id, { source: 'web', items: [{ ...line, amount: 1 }] })
    const discarded = await drafts.create(colleague.id, {
      source: 'web',
      items: [{ ...line, amount: 1 }],
    })
    await drafts.discard(colleague, discarded.id)

    const row = (list: any, id: number) => list.data.find((d: any) => d.id === id)
    const pick = (r: any) => [
      r.supplierId,
      r.lines,
      r.pieces,
      r.purchaseTotal,
      r.linesWithoutPurchase,
      r.canVoid,
    ]

    const forMe = await history(client, me)
    assert.sameMembers(
      forMe.data.map((d: any) => d.id),
      [mine, theirs]
    )
    // 24 × 14.90 = 357.60
    assert.deepEqual(pick(row(forMe, mine)), [me.id, 1, 24, 357.6, 0, true])
    assert.deepEqual(pick(row(forMe, theirs)), [colleague.id, 2, 12, null, 0, false])
    assert.equal(row(forMe, theirs).supplierName, colleague.displayName)
    assert.notInclude(JSON.stringify(forMe), '21.3')

    const onlyMine = await history(client, me, { scope: 'mine' })
    assert.deepEqual(
      onlyMine.data.map((d: any) => d.id),
      [mine]
    )

    // 10 × 21.30 = 213; one line without a purchase price.
    const forAdmin = await history(client, admin)
    assert.deepEqual(pick(row(forAdmin, theirs)), [colleague.id, 2, 12, 213, 1, true])
  })

  // Mutations caught: the product filter matching lots instead of draft lines, sorting by
  // a field outside the whitelist, a sort order ignored, a voided draft left out.
  test('the history filters by product, sorts on the server and keeps voided drafts', async ({
    client,
    assert,
  }) => {
    const me = await UserFactory.apply('supplier').create()
    const [pepsi, cola] = [await product(), await product()]
    const small = await stock(me, [{ productId: pepsi.id, amount: 2, price: 20 }])
    const big = await stock(me, [
      { productId: cola.id, amount: 24, price: 20 },
      { productId: pepsi.id, amount: 1, price: 20 },
    ])
    const medium = await stock(me, [{ productId: cola.id, amount: 6, price: 20 }])
    await drafts.voidStocked(me, medium, 'Naskladněno dvakrát')

    const byPieces = await history(client, me, { sortBy: 'pieces', sortOrder: 'asc' })
    assert.deepEqual(
      byPieces.data.map((d: any) => [d.id, d.pieces, d.status]),
      [
        [small, 2, 'committed'],
        [medium, 6, 'voided'],
        [big, 25, 'committed'],
      ]
    )
    const evil = await history(client, me, { sortBy: 'pieces; DROP TABLE stock_drafts' })
    assert.deepEqual(
      evil.data.map((d: any) => d.id),
      [medium, big, small]
    )
    const withPepsi = await history(client, me, { productId: pepsi.id })
    assert.sameMembers(
      withPepsi.data.map((d: any) => d.id),
      [small, big]
    )
    assert.equal(withPepsi.meta.total, 2)
  })
})
