import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Delivery from '#models/delivery'
import ProductGroup from '#models/product_group'
import StockDraft from '#models/stock_draft'
import StockDraftItem from '#models/stock_draft_item'
import { DateTime } from 'luxon'
import StockDraftService, {
  EMPTY_DRAFT_TTL_DAYS,
  StockDraftNeedsConfirmation,
  StockDraftUnknownReference,
  draftVersion,
} from '#services/shopping/stock_draft_service'
import NotificationService from '#services/notification_service'
import DeliveryService from '#services/delivery_service'
import { settleSideEffects } from '#services/side_effects'

const service = new StockDraftService()

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

async function supplierWithProduct(margin = 0) {
  const supplier = await UserFactory.apply('supplier').create()
  if (margin) {
    supplier.marginPercent = margin
    await supplier.save()
  }
  const category = await CategoryFactory.create()
  const product = await ProductFactory.merge({ categoryId: category.id }).create()
  return { supplier, category, product }
}

async function lot(
  supplierId: number,
  productId: number,
  amount: number,
  price: number,
  purchasePrice: number | null = null
) {
  return Delivery.create({
    supplierId,
    productId,
    amountSupplied: amount,
    amountLeft: amount,
    amountLost: 0,
    price,
    purchasePrice,
  })
}

/** Moves a draft's last change into the past, as if nobody had touched it since. */
async function age(draftId: number, hours: number) {
  await db
    .from('stock_drafts')
    .where('id', draftId)
    .update({ updated_at: DateTime.now().minus({ hours }).toJSDate() })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test.group('StockDraftService', (group) => {
  const sendRestockNotifications = NotificationService.prototype.sendRestockNotifications
  const getStockWarnings = DeliveryService.prototype.getStockWarnings
  const addStock = DeliveryService.prototype.addStock

  group.each.setup(async () => {
    await cleanAll()
    mail.fake()
    // Committing fires restock e-mails without waiting for them; their queries would race
    // the TRUNCATE in the teardown and deadlock it. The restock tests call it themselves.
    NotificationService.prototype.sendRestockNotifications = async () => {}
  })
  group.each.teardown(async () => {
    // Nothing started after the answer may still be running when the tables are emptied.
    await settleSideEffects()
    NotificationService.prototype.sendRestockNotifications = sendRestockNotifications
    DeliveryService.prototype.getStockWarnings = getStockWarnings
    DeliveryService.prototype.addStock = addStock
    mail.restore()
    await cleanAll()
  })

  test('unknown products become unmatched lines that block stocking', async ({ assert }) => {
    const { supplier, product } = await supplierWithProduct()

    const draft = await service.create(supplier.id, {
      source: 'mcp',
      note: 'Lidl',
      items: [
        { productId: product.id, label: 'PEPSI 0,33', amount: 24, purchasePrice: 14.904 },
        { productId: 999_999, label: 'NEZNÁMÉ', amount: 2, purchasePrice: 9.9 },
      ],
    })
    const items = await StockDraftItem.query().where('stockDraftId', draft.id).orderBy('sortOrder')
    assert.equal(items[0].productId, product.id)
    assert.equal(items[0].purchasePrice, 14.9)
    assert.isNull(items[1].productId)
    assert.deepEqual(StockDraftService.problems(items), [{ index: 1, problem: 'product' }])

    await assert.rejects(() => service.commit(supplier, draft.id), 'DRAFT_INCOMPLETE')
    assert.lengthOf(await Delivery.all(), 0)
  })

  test('an unknown product group is dropped instead of failing on the foreign key', async ({
    assert,
  }) => {
    const { supplier, category, product } = await supplierWithProduct()
    const real = await ProductGroup.create({ name: 'Cola', categoryId: category.id })

    const draft = await service.create(supplier.id, {
      source: 'shopping_list',
      items: [
        { productId: product.id, productGroupId: real.id, amount: 1, price: 10 },
        { productId: null, productGroupId: 999_999, label: 'Cokoliv', amount: 1, price: 10 },
      ],
    })
    const items = await StockDraftItem.query().where('stockDraftId', draft.id).orderBy('sortOrder')
    assert.equal(items[0].productGroupId, real.id)
    assert.isNull(items[1].productGroupId)
  })

  test('created inside a caller transaction, the draft and its audit entry roll back with it', async ({
    assert,
  }) => {
    const { supplier, product } = await supplierWithProduct()

    await assert.rejects(() =>
      db.transaction(async (trx) => {
        await service.create(
          supplier.id,
          { source: 'shopping_list', items: [{ productId: product.id, amount: 2, price: 10 }] },
          { client: trx }
        )
        throw new Error('something after the draft failed')
      })
    )

    assert.lengthOf(await StockDraft.all(), 0)
    assert.lengthOf(await db.from('audit_logs').where('action', 'stock_draft.created'), 0)
  })

  test('commits every line in one go, deriving missing selling prices from the margin', async ({
    assert,
  }) => {
    const { supplier, category } = await supplierWithProduct(5)
    const pepsi = await ProductFactory.merge({ categoryId: category.id }).create()
    const bar = await ProductFactory.merge({ categoryId: category.id }).create()
    const draft = await service.create(supplier.id, { source: 'web', items: [] })

    const { deliveries } = await service.commit(supplier, draft.id, {
      note: 'Kaufland',
      items: [
        { productId: pepsi.id, amount: 24, purchasePrice: 14.9 },
        { productId: bar.id, amount: 10, purchasePrice: null, price: 18 },
      ],
    })

    assert.lengthOf(deliveries, 2)
    const lots = await Delivery.query().orderBy('id', 'asc')
    assert.deepEqual(
      lots.map((d) => [d.productId, d.amountSupplied, d.amountLeft, d.price, d.purchasePrice]),
      [
        [pepsi.id, 24, 24, 16, 14.9],
        [bar.id, 10, 10, 18, null],
      ]
    )
    const committed = await StockDraft.findOrFail(draft.id)
    assert.equal(committed.status, 'committed')
    assert.equal(committed.note, 'Kaufland')
    const items = await StockDraftItem.query().where('stockDraftId', draft.id).orderBy('sortOrder')
    assert.deepEqual(
      items.map((i) => [i.deliveryId, i.price]),
      lots.map((d) => [d.id, d.price])
    )

    await assert.rejects(() => service.commit(supplier, draft.id), 'DRAFT_CLOSED')

    const audit = await db.from('audit_logs').select('action', 'user_id', 'target_user_id')
    assert.includeMembers(
      audit.map((row) => row.action),
      ['stock_draft.committed', 'delivery.created']
    )
    // The supplier stocked their own draft: no target user anywhere.
    for (const row of audit) {
      assert.equal(row.user_id, supplier.id)
      assert.isNull(row.target_user_id)
    }
  })

  test('an empty draft cannot be stocked', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const draft = await service.create(supplier.id, { source: 'web', items: [] })
    await assert.rejects(() => service.commit(supplier, draft.id), 'DRAFT_EMPTY')
  })

  test('a draft belongs to its supplier; an admin stocks it in their name', async ({ assert }) => {
    const { supplier, product } = await supplierWithProduct(10)
    const colleague = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const draft = await service.create(supplier.id, {
      source: 'mcp',
      items: [{ productId: product.id, amount: 6, purchasePrice: 10 }],
    })

    await assert.rejects(() => service.get(colleague, draft.id), 'DRAFT_NOT_FOUND')
    await assert.rejects(() => service.commit(colleague, draft.id), 'DRAFT_NOT_FOUND')

    await service.commit(admin, draft.id)
    const lotRow = await Delivery.firstOrFail()
    assert.equal(lotRow.supplierId, supplier.id)
    // The owner's margin, not the admin's: 10 * 1.10 = 11.
    assert.equal(lotRow.price, 11)

    // The audit says who really did it and for whom — for the draft and for every lot.
    for (const action of ['stock_draft.committed', 'delivery.created']) {
      const log = await db.from('audit_logs').where('action', action).firstOrFail()
      assert.equal(log.user_id, admin.id, action)
      assert.equal(log.target_user_id, supplier.id, action)
    }
  })

  test('a commit stops on a duplicate or an unusual price until it is confirmed', async ({
    assert,
  }) => {
    const { supplier, product } = await supplierWithProduct()
    await lot(supplier.id, product.id, 12, 25)
    const draft = await service.create(supplier.id, { source: 'web', items: [] })
    const items = [{ productId: product.id, amount: 12, price: 25 }]

    try {
      await service.commit(supplier, draft.id, { items })
      assert.fail('expected StockDraftNeedsConfirmation')
    } catch (error) {
      assert.instanceOf(error, StockDraftNeedsConfirmation)
      const { warnings } = error as StockDraftNeedsConfirmation
      assert.lengthOf(warnings, 1)
      assert.equal(warnings[0].index, 0)
      assert.equal(warnings[0].productId, product.id)
      assert.equal(warnings[0].productName, product.displayName)
      assert.equal(warnings[0].duplicate?.amount, 12)
      assert.isNull(warnings[0].unusualPrice)
    }
    // Nothing stocked, but the reviewed lines are kept and the draft stays open.
    assert.lengthOf(await Delivery.all(), 1)
    const saved = await StockDraft.query().where('id', draft.id).preload('items').firstOrFail()
    assert.equal(saved.status, 'open')
    assert.lengthOf(saved.items, 1)

    await service.commit(supplier, draft.id, { items, confirmWarnings: true })
    assert.lengthOf(await Delivery.all(), 2)

    // Another supplier stocking the same product at ten times the price gets a price warning.
    const other = await UserFactory.apply('supplier').create()
    const theirs = await service.create(other.id, {
      source: 'web',
      items: [{ productId: product.id, amount: 1, price: 250 }],
    })
    try {
      await service.commit(other, theirs.id)
      assert.fail('expected StockDraftNeedsConfirmation')
    } catch (error) {
      assert.instanceOf(error, StockDraftNeedsConfirmation)
      const { warnings } = error as StockDraftNeedsConfirmation
      assert.isNull(warnings[0].duplicate)
      assert.equal(warnings[0].unusualPrice?.lastPrice, 25)
    }
  })

  test('findOrCreateOpenDraft reuses the open draft and creates one only once', async ({
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const other = await UserFactory.apply('supplier').create()
    // Neither a colleague's draft nor a closed one is "the" draft.
    await StockDraft.create({ supplierId: other.id, source: 'web', status: 'open' })
    await StockDraft.create({
      supplierId: supplier.id,
      source: 'web',
      status: 'committed',
      committedAt: DateTime.now(),
    })

    const first = await service.findOrCreateOpenDraft(supplier.id)
    const second = await service.findOrCreateOpenDraft(supplier.id)
    assert.equal(second.id, first.id)
    assert.equal(first.supplierId, supplier.id)
    assert.lengthOf(await StockDraft.query().where('supplierId', supplier.id), 2)
    // An empty draft opened by "Stock" leaves no audit entry; its commit will.
    assert.lengthOf(await db.from('audit_logs').where('action', 'stock_draft.created'), 0)
  })

  test('the list, an assistant and "Stock" all fill the one open draft, each line with its source', async ({
    assert,
  }) => {
    const { supplier, category, product } = await supplierWithProduct()
    const other = await ProductFactory.merge({ categoryId: category.id }).create()
    const fromList = await service.appendLines(supplier.id, {
      source: 'shopping_list',
      note: 'Nákupní seznam',
      items: [{ productId: product.id, amount: 6, purchasePrice: 11 }],
    })
    assert.isTrue(fromList.created)
    // An old draft is no reason for a second one: there is only ever one.
    await age(fromList.draft.id, 72)

    const fromAi = await service.appendLines(supplier.id, {
      source: 'mcp',
      note: 'Účtenka Lidl',
      items: [
        // The same product again from the receipt: a line of its own, at its own price.
        { productId: product.id, amount: 6, purchasePrice: 10.5 },
        { productId: other.id, amount: 2, price: 30 },
      ],
    })
    assert.equal(fromAi.draft.id, fromList.draft.id)
    assert.isFalse(fromAi.created)
    assert.equal(fromAi.added, 2)

    const web = await service.appendProduct(supplier.id, other.id)
    assert.equal(web.draft.id, fromList.draft.id)
    assert.isTrue(web.existing)
    const fresh = await ProductFactory.merge({ categoryId: category.id }).create()
    await service.appendProduct(supplier.id, fresh.id)

    const items = await StockDraftItem.query()
      .where('stockDraftId', fromList.draft.id)
      .orderBy('sortOrder')
    assert.deepEqual(
      items.map((i) => [i.productId, i.source, i.sortOrder]),
      [
        [product.id, 'shopping_list', 0],
        [product.id, 'assistant', 1],
        [other.id, 'assistant', 2],
        [fresh.id, 'web', 3],
      ]
    )
    const draft = await StockDraft.findOrFail(fromList.draft.id)
    assert.equal(draft.note, 'Nákupní seznam · Účtenka Lidl')
    assert.lengthOf(await StockDraft.query().where('status', 'open'), 1)
    const actions = await db.from('audit_logs').orderBy('id').select('action')
    assert.deepEqual(
      actions.map((a) => a.action),
      ['stock_draft.created', 'stock_draft.lines_added']
    )

    // Saving the form keeps every line's source — the page sends it back.
    await service.update(supplier, draft.id, {
      items: items.map((i) => ({
        productId: i.productId,
        amount: i.amount,
        purchasePrice: i.purchasePrice,
        source: i.source,
      })),
    })
    const saved = await StockDraftItem.query().where('stockDraftId', draft.id).orderBy('sortOrder')
    assert.deepEqual(
      saved.map((i) => i.source),
      ['shopping_list', 'assistant', 'assistant', 'web']
    )
  })

  test('the list, an assistant and the web adding at once still leave one open draft', async ({
    assert,
  }) => {
    const { supplier, category, product } = await supplierWithProduct()
    const other = await ProductFactory.merge({ categoryId: category.id }).create()
    await Promise.all([
      service.appendLines(supplier.id, {
        source: 'shopping_list',
        items: [{ productId: product.id, amount: 6, price: 15 }],
      }),
      service.appendLines(supplier.id, {
        source: 'mcp',
        items: [{ productId: other.id, amount: 2, price: 30 }],
      }),
      service.appendProduct(supplier.id, product.id),
      service.findOrCreateOpenDraft(supplier.id),
    ])
    const open = await StockDraft.query().where('supplierId', supplier.id).where('status', 'open')
    assert.lengthOf(open, 1)
    const lines = await StockDraftItem.query().where('stockDraftId', open[0].id)
    assert.isAtLeast(lines.length, 2)
  })

  test('the database refuses a second open draft for one supplier', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    await StockDraft.create({ supplierId: supplier.id, source: 'web', status: 'open' })
    await assert.rejects(() =>
      StockDraft.create({ supplierId: supplier.id, source: 'mcp', status: 'open' })
    )
  })

  test('two "Stock" clicks at once open one draft with one line', async ({ assert }) => {
    const { supplier, product } = await supplierWithProduct()

    const drafts = await Promise.all([
      service.findOrCreateOpenDraft(supplier.id),
      service.findOrCreateOpenDraft(supplier.id),
      service.findOrCreateOpenDraft(supplier.id),
    ])
    assert.lengthOf(new Set(drafts.map((d) => d.id)), 1)

    const appended = await Promise.all([
      service.appendProduct(supplier.id, product.id),
      service.appendProduct(supplier.id, product.id),
    ])
    assert.equal(appended[0].item.id, appended[1].item.id)
    assert.lengthOf(await StockDraft.query().where('supplierId', supplier.id), 1)
    assert.lengthOf(await StockDraftItem.all(), 1)
  })

  test('appendProduct adds a line prefilled from the last lot, once per product', async ({
    assert,
  }) => {
    const { supplier, category, product } = await supplierWithProduct()
    const fresh = await ProductFactory.merge({ categoryId: category.id }).create()
    await lot(supplier.id, product.id, 10, 15, 12.5)
    await lot(supplier.id, product.id, 10, 18, 13.9)

    const first = await service.appendProduct(supplier.id, product.id)
    assert.isFalse(first.existing)
    assert.equal(first.item.productId, product.id)
    assert.equal(first.item.amount, 1)
    assert.equal(first.item.purchasePrice, 13.9)
    assert.equal(first.item.price, 18)
    assert.equal(first.item.sortOrder, 0)

    const second = await service.appendProduct(supplier.id, fresh.id)
    assert.equal(second.draft.id, first.draft.id)
    assert.equal(second.item.sortOrder, 1)
    assert.isNull(second.item.purchasePrice)
    assert.isNull(second.item.price)

    // The same product again: no second line, the existing one comes back to be focused.
    const again = await service.appendProduct(supplier.id, product.id)
    assert.isTrue(again.existing)
    assert.equal(again.item.id, first.item.id)
    assert.lengthOf(await StockDraftItem.query().where('stockDraftId', first.draft.id), 2)

    await assert.rejects(() => service.appendProduct(supplier.id, 999_999), 'PRODUCT_NOT_FOUND')
  })

  test("a colleague's purchase price is never prefilled, their selling price is", async ({
    assert,
  }) => {
    const { supplier, product } = await supplierWithProduct()
    const colleague = await UserFactory.apply('supplier').create()
    await lot(supplier.id, product.id, 10, 15, 11.5)
    await lot(colleague.id, product.id, 10, 19, 16.4)

    const { item } = await service.appendProduct(supplier.id, product.id)
    assert.equal(item.price, 19)
    assert.equal(item.purchasePrice, 11.5)

    const colleaguePrices = await service.lastPrices(colleague.id)
    const theirs = colleaguePrices.get(product.id)
    assert.deepEqual(theirs, { price: 19, purchasePrice: 16.4 })
    const newcomer = await UserFactory.apply('supplier').create()
    const newcomerPrices = await service.lastPrices(newcomer.id)
    assert.deepEqual(newcomerPrices.get(product.id), {
      price: 19,
      purchasePrice: null,
    })
  })

  test('setLineProduct fills the line the supplier came from, else appends the product', async ({
    assert,
  }) => {
    const { supplier, category, product } = await supplierWithProduct()
    const created = await ProductFactory.merge({ categoryId: category.id }).create()
    const draft = await service.create(supplier.id, {
      source: 'shopping_list',
      items: [
        { label: 'Energy drink bez cukru', amount: 12, purchasePrice: 24.9 },
        { productId: product.id, label: 'Pepsi', amount: 6, price: 15 },
      ],
    })

    // The unmatched first line gets the new product and keeps its pieces and price.
    const first = await service.setLineProduct(supplier, draft.id, 0, created.id)
    assert.equal(first.item.productId, created.id)
    assert.equal(first.item.amount, 12)
    assert.equal(Number(first.item.purchasePrice), 24.9)

    // A line that already has a product is left alone: the product becomes a new line.
    const second = await service.setLineProduct(supplier, draft.id, 1, created.id)
    const items = await StockDraftItem.query().where('stockDraftId', draft.id).orderBy('sortOrder')
    assert.lengthOf(items, 3)
    assert.equal(items[1].productId, product.id)
    assert.equal(second.item.productId, created.id)
    assert.equal(second.item.sortOrder, 2)

    // An index past the end appends too; a closed draft refuses.
    await service.setLineProduct(supplier, draft.id, 99, created.id)
    assert.lengthOf(await StockDraftItem.query().where('stockDraftId', draft.id), 4)
    await service.discard(supplier, draft.id)
    await assert.rejects(
      () => service.setLineProduct(supplier, draft.id, 0, created.id),
      /DRAFT_CLOSED/
    )
  })

  test('countOpen and openSummary see the open draft only once it has lines', async ({
    assert,
  }) => {
    const { supplier, product } = await supplierWithProduct()
    const empty = await service.findOrCreateOpenDraft(supplier.id)
    assert.equal(await service.countOpen(supplier.id), 0)
    assert.isNull(await service.openSummary(supplier.id))
    const listed = await service.listOpen(supplier.id)
    assert.deepEqual(
      listed.map((d) => [d.id, d.isEmpty]),
      [[empty.id, true]]
    )

    await service.appendLines(supplier.id, {
      source: 'mcp',
      items: [
        { productId: product.id, amount: 3, price: 10 },
        { productId: product.id, amount: 2, price: 11 },
      ],
    })
    assert.equal(await service.countOpen(supplier.id), 1)
    assert.deepEqual(await service.openSummary(supplier.id), {
      id: empty.id,
      lines: 2,
      pieces: 5,
    })
  })

  test('a discarded draft stays closed', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const draft = await service.create(supplier.id, { source: 'web', items: [] })
    await service.discard(supplier, draft.id)
    const discarded = await StockDraft.findOrFail(draft.id)
    assert.equal(discarded.status, 'discarded')
    await assert.rejects(() => service.discard(supplier, draft.id), 'DRAFT_CLOSED')
    assert.lengthOf(await service.listOpen(supplier.id), 0)
  })
  test('a line without a selling price never goes below the last one (web and server agree)', async ({
    assert,
  }) => {
    const { supplier, product } = await supplierWithProduct()
    await lot(supplier.id, product.id, 1, 18, 14.9)
    await db.from('deliveries').update({ amount_left: 0 })
    const draft = await service.create(supplier.id, {
      source: 'mcp',
      items: [{ productId: product.id, amount: 6, purchasePrice: 14.9, price: null }],
    })

    await service.commit(supplier, draft.id, { confirmWarnings: true })
    const stocked = await Delivery.query().orderBy('id', 'desc').firstOrFail()
    // 14.90 at 0 % would be 15; the product already sells for 18.
    assert.equal(stocked.price, 18)
  })

  test('a line with no prices at all takes the last selling price', async ({ assert }) => {
    const { supplier, product } = await supplierWithProduct()
    await lot(supplier.id, product.id, 1, 22)
    const draft = await service.create(supplier.id, {
      source: 'mcp',
      items: [{ productId: product.id, amount: 2 }],
    })
    assert.deepEqual(StockDraftService.problems(draft.items ?? [], new Map()), [])
    const { deliveries } = await service.commit(supplier, draft.id, { confirmWarnings: true })
    assert.equal(deliveries[0].price, 22)
  })

  test('a save racing the commit cannot change what gets stocked', async ({ assert }) => {
    const { supplier, product } = await supplierWithProduct()
    const draft = await service.create(supplier.id, { source: 'web', items: [] })

    let racing: Promise<unknown> | null = null
    DeliveryService.prototype.getStockWarnings = async function (...args) {
      // An autosave (or an assistant) rewriting the lines while the commit checks them.
      racing ??= service.update(supplier, draft.id, {
        items: [{ productId: product.id, amount: 99, price: 10 }],
      })
      await Promise.race([racing.catch(() => {}), sleep(300)])
      return getStockWarnings.apply(this, args)
    }

    await service.commit(supplier, draft.id, {
      items: [{ productId: product.id, amount: 2, price: 10 }],
    })
    const lots = await Delivery.all()
    assert.lengthOf(lots, 1)
    assert.equal(lots[0].amountSupplied, 2)
    // The save waited for the commit and then found the draft closed.
    await assert.rejects(() => racing!, 'DRAFT_CLOSED')
  })

  test('a save or commit over a newer version is refused as stale', async ({ assert }) => {
    const { supplier, product } = await supplierWithProduct()
    const draft = await service.create(supplier.id, {
      source: 'mcp',
      items: [{ productId: product.id, amount: 6, price: 15 }],
    })
    const loaded = draftVersion(await service.get(supplier, draft.id))

    // An assistant fixes the line in the meantime (no version: last write wins there).
    const fixed = await service.update(supplier, draft.id, {
      items: [{ productId: product.id, amount: 12, price: 15 }],
    })
    assert.notEqual(draftVersion(fixed), loaded)

    await assert.rejects(
      () =>
        service.update(supplier, draft.id, {
          version: loaded,
          items: [{ productId: product.id, amount: 6, price: 15 }],
        }),
      'DRAFT_STALE'
    )
    await assert.rejects(
      () => service.commit(supplier, draft.id, { version: loaded, confirmWarnings: true }),
      'DRAFT_STALE'
    )
    const items = await StockDraftItem.query().where('stockDraftId', draft.id)
    assert.equal(items[0].amount, 12)
    assert.lengthOf(await Delivery.all(), 0)

    // With the current version both go through, and every change moves the version on.
    const saved = await service.update(supplier, draft.id, {
      version: draftVersion(fixed),
      items: [{ productId: product.id, amount: 10, price: 15 }],
    })
    assert.isAbove(draftVersion(saved), draftVersion(fixed))
    const another = await ProductFactory.merge({ categoryId: product.categoryId }).create()
    const appended = await service.appendProduct(supplier.id, another.id)
    assert.equal(appended.draft.id, draft.id)
    await assert.rejects(
      () => service.commit(supplier, draft.id, { version: draftVersion(saved) }),
      'DRAFT_STALE'
    )
  })

  test('a failure half-way through a commit stocks nothing', async ({ assert }) => {
    const { supplier, category, product } = await supplierWithProduct()
    const other = await ProductFactory.merge({ categoryId: category.id }).create()
    const third = await ProductFactory.merge({ categoryId: category.id }).create()
    const draft = await service.create(supplier.id, {
      source: 'web',
      items: [
        { productId: product.id, amount: 1, price: 10 },
        { productId: other.id, amount: 1, price: 10 },
        { productId: third.id, amount: 1, price: 10 },
      ],
    })
    let calls = 0
    DeliveryService.prototype.addStock = async function (...args) {
      if (++calls === 2) throw new Error('database hiccup')
      return addStock.apply(this, args)
    }

    await assert.rejects(() => service.commit(supplier, draft.id, { confirmWarnings: true }))
    assert.lengthOf(await Delivery.all(), 0)
    const stillOpen = await StockDraft.findOrFail(draft.id)
    assert.equal(stillOpen.status, 'open')
  })

  test('two commits at once stock the draft once', async ({ assert }) => {
    const { supplier, product } = await supplierWithProduct()
    const draft = await service.create(supplier.id, {
      source: 'web',
      items: [{ productId: product.id, amount: 3, price: 10 }],
    })
    const results = await Promise.allSettled([
      service.commit(supplier, draft.id, { confirmWarnings: true }),
      service.commit(supplier, draft.id, { confirmWarnings: true }),
    ])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.lengthOf(await Delivery.all(), 1)
  })

  test('estimated purchase prices from the list ask once more before stocking', async ({
    assert,
  }) => {
    const { supplier, category, product } = await supplierWithProduct()
    const typed = await ProductFactory.merge({ categoryId: category.id }).create()
    const draft = await service.create(supplier.id, {
      source: 'shopping_list',
      items: [
        { productId: product.id, amount: 6, purchasePrice: 12.5 },
        { productId: typed.id, amount: 6, purchasePrice: null, price: 20 },
      ],
    })
    const items = await StockDraftItem.query().where('stockDraftId', draft.id).orderBy('sortOrder')
    assert.deepEqual(
      items.map((i) => i.purchasePriceEstimated),
      [true, false]
    )

    try {
      await service.commit(supplier, draft.id)
      assert.fail('expected StockDraftNeedsConfirmation')
    } catch (error) {
      assert.instanceOf(error, StockDraftNeedsConfirmation)
      const { warnings } = error as StockDraftNeedsConfirmation
      assert.lengthOf(warnings, 1)
      assert.equal(warnings[0].productId, product.id)
      assert.isTrue(warnings[0].estimatedPurchasePrice)
      assert.equal(warnings[0].price, 13)
    }

    // The supplier typed the receipt price: the flag goes and the commit is clean.
    await service.commit(supplier, draft.id, {
      items: [
        { productId: product.id, amount: 6, purchasePrice: 11.9 },
        { productId: typed.id, amount: 6, price: 20 },
      ],
    })
    assert.lengthOf(await Delivery.all(), 2)
  })

  test('a line with no pieces is dropped, never turned into one piece', async ({ assert }) => {
    const { supplier, product } = await supplierWithProduct()
    const draft = await service.create(supplier.id, {
      source: 'mcp',
      items: [
        { productId: product.id, amount: 0, price: 10 },
        { productId: product.id, amount: 4, price: 10 },
      ],
    })
    const items = await StockDraftItem.query().where('stockDraftId', draft.id)
    assert.deepEqual(
      items.map((i) => i.amount),
      [4]
    )
  })

  test('strict mode names the line with an unknown product or group', async ({ assert }) => {
    const { supplier, product } = await supplierWithProduct()
    try {
      await service.create(
        supplier.id,
        {
          source: 'mcp',
          items: [
            { productId: product.id, amount: 1, price: 10 },
            { productId: 999_999, amount: 6 },
          ],
        },
        { strict: true }
      )
      assert.fail('expected StockDraftUnknownReference')
    } catch (error) {
      assert.instanceOf(error, StockDraftUnknownReference)
      const unknown = error as StockDraftUnknownReference
      assert.equal(unknown.code, 'PRODUCT_NOT_FOUND')
      assert.equal(unknown.index, 1)
      assert.equal(unknown.id, 999_999)
    }
    assert.lengthOf(await StockDraft.all(), 0)

    const draft = await service.create(supplier.id, { source: 'mcp', items: [] })
    await assert.rejects(
      () =>
        service.update(
          supplier,
          draft.id,
          { items: [{ productGroupId: 888_888, label: 'x', amount: 1 }] },
          { strict: true }
        ),
      'GROUP_NOT_FOUND'
    )
  })

  test('empty drafts left for a week are discarded, anything with lines stays', async ({
    assert,
  }) => {
    const { supplier, product } = await supplierWithProduct()
    const neighbour = await UserFactory.apply('supplier').create()
    const fresher = await UserFactory.apply('supplier').create()
    const stale = await service.findOrCreateOpenDraft(supplier.id)
    const fresh = await service.findOrCreateOpenDraft(fresher.id)
    const oldWithLines = await service.create(neighbour.id, {
      source: 'web',
      items: [{ productId: product.id, amount: 1, price: 10 }],
    })
    await age(stale.id, EMPTY_DRAFT_TTL_DAYS * 24 + 1)
    await age(oldWithLines.id, EMPTY_DRAFT_TTL_DAYS * 24 + 1)

    assert.equal(await service.discardStaleEmpty(), 1)
    const statuses = await StockDraft.query().orderBy('id')
    assert.deepEqual(
      statuses.map((d) => [d.id, d.status]),
      [
        [stale.id, 'discarded'],
        [fresh.id, 'open'],
        [oldWithLines.id, 'open'],
      ]
    )
  })

  test('restock e-mails: only for products that had run out, one per person', async ({
    assert,
  }) => {
    NotificationService.prototype.sendRestockNotifications = sendRestockNotifications
    const fakeMailer = mail.fake()
    const { supplier, category, product: pepsi } = await supplierWithProduct()
    const cola = await ProductFactory.merge({ categoryId: category.id }).create()
    const water = await ProductFactory.merge({ categoryId: category.id }).create()
    const fan = await UserFactory.create()
    const now = new Date()
    await db.table('user_favorites').multiInsert(
      [pepsi, cola, water].map((p) => ({
        user_id: fan.id,
        product_id: p.id,
        created_at: now,
      }))
    )
    // Water still has pieces on the shelf: topping it up is no news.
    await lot(supplier.id, water.id, 3, 10)

    const draft = await service.create(supplier.id, {
      source: 'web',
      items: [
        { productId: pepsi.id, amount: 6, price: 15 },
        { productId: pepsi.id, amount: 6, price: 15 },
        { productId: cola.id, amount: 6, price: 15 },
        { productId: water.id, amount: 6, price: 10 },
      ],
    })
    await service.commit(supplier, draft.id, { confirmWarnings: true })

    assert.deepEqual(await settleSideEffects(), [])
    const sent = fakeMailer.messages.sent()
    assert.lengthOf(sent, 1)
    assert.isTrue(sent[0].hasTo(fan.email))
    const html = String(sent[0].toJSON().message.html ?? '')
    assert.include(html, pepsi.displayName)
    assert.include(html, cola.displayName)
    assert.notInclude(html, water.displayName)
  })
  test('a stocked draft is voided as a whole: every lot, one reason, one audit entry', async ({
    assert,
  }) => {
    const { supplier, category, product } = await supplierWithProduct()
    const other = await ProductFactory.merge({ categoryId: category.id }).create()
    const draft = await service.create(supplier.id, {
      source: 'mcp',
      items: [
        { productId: product.id, amount: 6, price: 15, purchasePrice: 11 },
        { productId: other.id, amount: 4, price: 20 },
      ],
    })
    await service.commit(supplier, draft.id, { confirmWarnings: true })
    assert.isTrue(await service.canVoid(draft.id))

    const { voidedDeliveries } = await service.voidStocked(supplier, draft.id, 'Účtenka dvakrát')
    assert.equal(voidedDeliveries, 2)
    const lots = await Delivery.query().orderBy('id')
    assert.isTrue(lots.every((l) => l.voidedAt !== null && l.amountLeft === 0))
    const voided = await StockDraft.findOrFail(draft.id)
    assert.equal(voided.status, 'voided')
    assert.equal(voided.voidReason, 'Účtenka dvakrát')
    assert.isNotNull(voided.committedAt)

    const audit = await db.from('audit_logs').where('action', 'stock_draft.voided').firstOrFail()
    assert.equal(audit.entity_id, draft.id)
    assert.lengthOf(await db.from('audit_logs').where('action', 'delivery.voided'), 2)

    await assert.rejects(() => service.voidStocked(supplier, draft.id, 'znovu'), 'DRAFT_VOIDED')
  })

  test('a draft something was sold or written off from is not voided, not even in part', async ({
    assert,
  }) => {
    const { supplier, category, product } = await supplierWithProduct()
    const other = await ProductFactory.merge({ categoryId: category.id }).create()
    const draft = await service.create(supplier.id, {
      source: 'web',
      items: [
        { productId: product.id, amount: 6, price: 15 },
        { productId: other.id, amount: 4, price: 20 },
      ],
    })
    const { deliveries } = await service.commit(supplier, draft.id, { confirmWarnings: true })
    // One piece of the second lot was sold.
    await db.from('deliveries').where('id', deliveries[1].id).update({ amount_left: 3 })

    assert.isFalse(await service.canVoid(draft.id))
    await assert.rejects(
      () => service.voidStocked(supplier, draft.id, 'Účtenka dvakrát'),
      'DRAFT_HAS_SALES'
    )
    const lots = await Delivery.query().whereNotNull('voidedAt')
    assert.lengthOf(lots, 0)
    const still = await StockDraft.findOrFail(draft.id)
    assert.equal(still.status, 'committed')
  })

  test('a lot voided on its own before is skipped; open drafts and strangers are refused', async ({
    assert,
  }) => {
    const { supplier, category, product } = await supplierWithProduct()
    const other = await ProductFactory.merge({ categoryId: category.id }).create()
    const colleague = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const draft = await service.create(supplier.id, {
      source: 'web',
      items: [
        { productId: product.id, amount: 6, price: 15 },
        { productId: other.id, amount: 4, price: 20 },
      ],
    })
    const { deliveries } = await service.commit(supplier, draft.id, { confirmWarnings: true })
    // The next lines open a new draft once the first one is stocked.
    const open = await service.create(supplier.id, {
      source: 'mcp',
      items: [{ productId: product.id, amount: 1, price: 15 }],
    })
    await new DeliveryService().voidDelivery(supplier, deliveries[0].id, 'Duplicita')

    await assert.rejects(
      () => service.voidStocked(supplier, open.id, 'x x x'),
      'DRAFT_NOT_COMMITTED'
    )
    await assert.rejects(() => service.voidStocked(colleague, draft.id, 'x x x'), 'DRAFT_NOT_FOUND')

    // An admin voids it for the supplier; only the lot still live is voided now.
    const { voidedDeliveries } = await service.voidStocked(admin, draft.id, 'Špatná lednice')
    assert.equal(voidedDeliveries, 1)
    const log = await db.from('audit_logs').where('action', 'stock_draft.voided').firstOrFail()
    assert.equal(log.user_id, admin.id)
    assert.equal(log.target_user_id, supplier.id)
  })

  test('the stocked history: own drafts of the last 30 days, totals and whether they can be voided', async ({
    assert,
  }) => {
    const { supplier, category, product } = await supplierWithProduct()
    const other = await ProductFactory.merge({ categoryId: category.id }).create()
    const colleague = await UserFactory.apply('supplier').create()
    const recent = await service.create(supplier.id, {
      source: 'shopping_list',
      items: [
        { productId: product.id, amount: 6, price: 15, purchasePrice: 10.5 },
        { productId: other.id, amount: 2, price: 20 },
      ],
    })
    await service.commit(supplier, recent.id, { confirmWarnings: true })
    const old = await service.create(supplier.id, {
      source: 'web',
      items: [{ productId: product.id, amount: 1, price: 15 }],
    })
    await service.commit(supplier, old.id, { confirmWarnings: true })
    await db
      .from('stock_drafts')
      .where('id', old.id)
      .update({ committed_at: DateTime.now().minus({ days: 31 }).toJSDate() })
    const theirs = await service.create(colleague.id, {
      source: 'web',
      items: [{ productId: product.id, amount: 1, price: 15 }],
    })
    await service.commit(colleague, theirs.id, { confirmWarnings: true })
    await service.create(supplier.id, {
      source: 'mcp',
      items: [{ productId: product.id, amount: 1, price: 15 }],
    })

    const { data, meta } = await service.listStocked(supplier.id)
    assert.equal(meta.total, 1)
    assert.lengthOf(data, 1)
    assert.include(data[0], {
      id: recent.id,
      source: 'shopping_list',
      status: 'committed',
      lines: 2,
      pieces: 8,
      purchaseTotal: 63,
      linesWithoutPurchase: 1,
      canVoid: true,
    })

    await service.voidStocked(supplier, recent.id, 'Účtenka dvakrát')
    const afterVoid = await service.listStocked(supplier.id)
    const [voided] = afterVoid.data
    assert.equal(voided.status, 'voided')
    assert.isFalse(voided.canVoid)
    assert.isNotNull(voided.voidedAt)
  })
  test('a draft whose stock was handed over to another supplier is not voided', async ({
    assert,
  }) => {
    const { supplier, product } = await supplierWithProduct()
    const successor = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const draft = await service.create(supplier.id, {
      source: 'web',
      items: [{ productId: product.id, amount: 5, price: 15 }],
    })
    await service.commit(supplier, draft.id, { confirmWarnings: true })
    // The original lot is now 0 / 0 / 0 — it looks untouched, but its pieces live on.
    await new DeliveryService().transferStock(supplier.id, successor.id, admin)

    assert.isFalse(await service.canVoid(draft.id))
    const listed = await service.listStocked(supplier.id)
    assert.isFalse(listed.data[0].canVoid)
    await assert.rejects(
      () => service.voidStocked(supplier, draft.id, 'Účtenka dvakrát'),
      'DRAFT_TRANSFERRED'
    )
    const theirs = await Delivery.query().where('supplierId', successor.id).firstOrFail()
    assert.isNull(theirs.voidedAt)
    assert.equal(theirs.amountLeft, 5)
  })
  test("the history of stocked drafts: mine or the whole fridge, a colleague's cost hidden", async ({
    assert,
  }) => {
    const { supplier, category, product } = await supplierWithProduct()
    const other = await ProductFactory.merge({ categoryId: category.id }).create()
    const colleague = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const mine = await service.create(supplier.id, {
      source: 'web',
      items: [
        { productId: product.id, amount: 4, price: 15, purchasePrice: 10 },
        { productId: other.id, amount: 1, price: 30 },
      ],
    })
    await service.commit(supplier, mine.id, { confirmWarnings: true })
    const theirs = await service.create(colleague.id, {
      source: 'mcp',
      items: [{ productId: other.id, amount: 6, price: 30, purchasePrice: 20 }],
    })
    await service.commit(colleague, theirs.id, { confirmWarnings: true })
    // Still open: not history.
    await service.create(supplier.id, {
      source: 'web',
      items: [{ productId: product.id, amount: 1, price: 15 }],
    })

    const own = await service.listHistory(supplier, 1, 20, { scope: 'mine' })
    assert.deepEqual(
      own.data.map((d) => d.id),
      [mine.id]
    )
    assert.include(own.data[0], { pieces: 5, lines: 2, purchaseTotal: 40, canVoid: true })

    const all = await service.listHistory(supplier, 1, 20, { scope: 'all' })
    // Newest number first by default.
    assert.deepEqual(
      all.data.map((d) => d.id),
      [theirs.id, mine.id]
    )
    assert.include(all.data[0], {
      supplierId: colleague.id,
      supplierName: colleague.displayName,
      purchaseTotal: null,
      canVoid: false,
    })

    const sorted = await service.listHistory(supplier, 1, 20, {
      scope: 'all',
      sortBy: 'pieces',
      sortOrder: 'asc',
    })
    assert.deepEqual(
      sorted.data.map((d) => d.pieces),
      [5, 6]
    )
    const byProduct = await service.listHistory(supplier, 1, 20, {
      scope: 'all',
      productId: product.id,
    })
    assert.deepEqual(
      byProduct.data.map((d) => d.id),
      [mine.id]
    )

    // An admin sees every cost and may void any draft.
    const asAdmin = await service.listHistory(admin, 1, 20, { scope: 'all' })
    assert.include(asAdmin.data[0], { purchaseTotal: 120, canVoid: true })
  })
})
