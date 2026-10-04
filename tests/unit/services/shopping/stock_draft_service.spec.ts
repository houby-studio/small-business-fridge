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
import StockDraftService, {
  StockDraftNeedsConfirmation,
} from '#services/shopping/stock_draft_service'
import NotificationService from '#services/notification_service'

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

test.group('StockDraftService', (group) => {
  const sendRestockNotification = NotificationService.prototype.sendRestockNotification

  group.each.setup(async () => {
    await cleanAll()
    mail.fake()
    // Committing fires restock e-mails without waiting for them; their queries would race
    // the TRUNCATE in the teardown and deadlock it. Nothing here is about those e-mails.
    NotificationService.prototype.sendRestockNotification = async () => {}
  })
  group.each.teardown(async () => {
    NotificationService.prototype.sendRestockNotification = sendRestockNotification
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
      ['stock_draft.created', 'stock_draft.committed', 'delivery.created']
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

  test('findOrCreateWebDraft reuses the open web draft and creates one only once', async ({
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const other = await UserFactory.apply('supplier').create()
    // Neither a colleague's draft nor an AI-prepared one is "the" web draft.
    await StockDraft.create({ supplierId: other.id, source: 'web', status: 'open' })
    await StockDraft.create({ supplierId: supplier.id, source: 'mcp', status: 'open' })
    await StockDraft.create({ supplierId: supplier.id, source: 'web', status: 'committed' })

    const first = await service.findOrCreateWebDraft(supplier.id)
    const second = await service.findOrCreateWebDraft(supplier.id)
    assert.isTrue(first.$isLocal)
    assert.isFalse(second.$isLocal)
    assert.equal(second.id, first.id)
    assert.equal(first.source, 'web')
    assert.equal(first.supplierId, supplier.id)
    assert.lengthOf(
      await StockDraft.query().where('supplierId', supplier.id).where('source', 'web'),
      2
    )
    assert.lengthOf(await db.from('audit_logs').where('action', 'stock_draft.created'), 1)
  })

  test('appendProduct adds a line prefilled from the last lot to the web draft', async ({
    assert,
  }) => {
    const { supplier, category, product } = await supplierWithProduct()
    const fresh = await ProductFactory.merge({ categoryId: category.id }).create()
    await lot(supplier.id, product.id, 10, 15, 12.5)
    await lot(supplier.id, product.id, 10, 18, 13.9)

    const first = await service.appendProduct(supplier.id, product.id)
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

    await assert.rejects(() => service.appendProduct(supplier.id, 999_999), 'PRODUCT_NOT_FOUND')
    assert.lengthOf(await db.from('audit_logs').where('action', 'stock_draft.created'), 1)
  })

  test('countOpen skips empty drafts, listOpen flags them', async ({ assert }) => {
    const { supplier, product } = await supplierWithProduct()
    const empty = await service.create(supplier.id, { source: 'web', items: [] })
    const filled = await service.create(supplier.id, {
      source: 'mcp',
      items: [{ productId: product.id, amount: 3, price: 10 }],
    })
    await service
      .create(supplier.id, { source: 'web', items: [] })
      .then((d) => service.discard(supplier, d.id))

    assert.equal(await service.countOpen(supplier.id), 1)
    const listed = await service.listOpen(supplier.id)
    assert.deepEqual(
      listed.map((d) => [d.id, d.isEmpty, d.lines]).sort((a, b) => Number(a[0]) - Number(b[0])),
      [
        [empty.id, true, 0],
        [filled.id, false, 1],
      ]
    )
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
})
