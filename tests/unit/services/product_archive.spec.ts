import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import Product from '#models/product'
import StockDraft from '#models/stock_draft'
import StockDraftItem from '#models/stock_draft_item'
import ProductService from '#services/product_service'
import DeliveryService from '#services/delivery_service'
import ShopService from '#services/shop_service'
import RecommendationService from '#services/recommendation_service'
import { isDomainError } from '#services/domain_error'

const service = new ProductService()

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups, audit_logs CASCADE')
}

async function setup() {
  const supplier = await UserFactory.apply('supplier').create()
  const category = await CategoryFactory.create()
  const product = await ProductFactory.merge({ categoryId: category.id }).create()
  return { supplier, category, product }
}

async function archiveError(actorId: number, productId: number) {
  try {
    await service.archive(actorId, productId)
    return null
  } catch (error) {
    if (isDomainError(error)) return error.code
    throw error
  }
}

async function auditActions(productId: number) {
  const rows = await db
    .from('audit_logs')
    .where('entity_type', 'product')
    .where('entity_id', productId)
    .orderBy('id', 'asc')
    .select('action', 'metadata')
  return rows.map((row) => row.action)
}

test.group('ProductService — archive', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a product with pieces left cannot be archived, a sold-out or voided one can', async ({
    assert,
  }) => {
    const { supplier, product } = await setup()
    const lot = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 5,
      amountLeft: 2,
    }).create()

    assert.equal(await archiveError(supplier.id, product.id), 'PRODUCT_HAS_STOCK')
    await product.refresh()
    assert.isNull(product.archivedAt)

    // A voided lot no longer counts as stock.
    lot.voidedAt = DateTime.now()
    await lot.save()
    assert.isNull(await archiveError(supplier.id, product.id))
    await product.refresh()
    assert.isNotNull(product.archivedAt)
    assert.deepEqual(await auditActions(product.id), ['product.archived'])
  })

  test('a product on an open draft cannot be archived; a committed draft does not block', async ({
    assert,
  }) => {
    const { supplier, product } = await setup()
    const draft = await StockDraft.create({
      supplierId: supplier.id,
      source: 'web',
      status: 'open',
    })
    await StockDraftItem.create({
      stockDraftId: draft.id,
      productId: product.id,
      amount: 1,
      price: 10,
      sortOrder: 0,
    })
    assert.equal(await archiveError(supplier.id, product.id), 'PRODUCT_IN_OPEN_DRAFT')

    draft.status = 'committed'
    draft.committedAt = DateTime.now()
    await draft.save()
    assert.isNull(await archiveError(supplier.id, product.id))
  })

  test('any supplier may archive and restore, both idempotent and audited once', async ({
    assert,
  }) => {
    const { product } = await setup()
    const colleague = await UserFactory.apply('supplier').create()

    await service.archive(colleague.id, product.id)
    await service.archive(colleague.id, product.id)
    await service.unarchive(colleague.id, product.id)
    await service.unarchive(colleague.id, product.id)

    await product.refresh()
    assert.isNull(product.archivedAt)
    assert.deepEqual(await auditActions(product.id), ['product.archived', 'product.unarchived'])
    assert.equal(await archiveError(colleague.id, 999999), 'PRODUCT_NOT_FOUND')
  })

  test('stocking brings an archived product back, and only an archived one', async ({ assert }) => {
    const { supplier, product } = await setup()
    await service.archive(supplier.id, product.id)

    await db.transaction((trx) => ProductService.unarchiveForStock(product.id, supplier.id, trx))
    await product.refresh()
    assert.isNull(product.archivedAt)
    const restored = await db
      .from('audit_logs')
      .where('action', 'product.unarchived')
      .where('entity_id', product.id)
      .first()
    assert.equal(restored.metadata.reason, 'stocked')

    // Not archived: nothing happens, nothing is logged.
    await db.transaction((trx) => ProductService.unarchiveForStock(product.id, supplier.id, trx))
    assert.deepEqual(await auditActions(product.id), ['product.archived', 'product.unarchived'])
  })
})

test.group('ProductService — stocking an archived product', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a new delivery brings the product back, logged as restored by stocking', async ({
    assert,
  }) => {
    const { supplier, product } = await setup()
    await service.archive(supplier.id, product.id)

    await new DeliveryService().addStock(supplier.id, product.id, 3, 20)

    await product.refresh()
    assert.isNull(product.archivedAt)
    const restored = await db
      .from('audit_logs')
      .where('action', 'product.unarchived')
      .where('entity_id', product.id)
      .first()
    assert.equal(restored.metadata.reason, 'stocked')
    assert.equal(restored.user_id, supplier.id)
  })
})

test.group('ProductService — archived products disappear', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('the supplier list hides them by default and filters by status and photo', async ({
    assert,
  }) => {
    const category = await CategoryFactory.create()
    await ProductFactory.merge({ categoryId: category.id, displayName: 'Active' }).create()
    await ProductFactory.merge({
      categoryId: category.id,
      displayName: 'Archived',
      archivedAt: DateTime.now(),
    }).create()
    await ProductFactory.merge({
      categoryId: category.id,
      displayName: 'No photo',
      imagePath: null,
    }).create()
    await ProductFactory.merge({
      categoryId: category.id,
      displayName: 'Legacy placeholder',
      imagePath: 'preview.png',
    }).create()

    const names = async (filters: Parameters<ProductService['getProductsPaginated']>[2]) => {
      const page = await service.getProductsPaginated(1, 20, filters)
      return page.all().map((p) => p.displayName)
    }

    assert.deepEqual(await names({}), ['Active', 'Legacy placeholder', 'No photo'])
    assert.deepEqual(await names({ status: 'archived' }), ['Archived'])
    assert.lengthOf(await names({ status: 'all' }), 4)
    assert.deepEqual(await names({ missingPhoto: true }), ['Legacy placeholder', 'No photo'])
  })

  test('the shop and kiosk never list them, not even with "show all"', async ({ assert }) => {
    const category = await CategoryFactory.create()
    const kept = await ProductFactory.merge({ categoryId: category.id }).create()
    const archived = await ProductFactory.merge({
      categoryId: category.id,
      archivedAt: DateTime.now(),
    }).create()

    const shop = new ShopService()
    const ids = (rows: { id: number }[]) => rows.map((row) => row.id)
    const all = await shop.getProducts({ showAll: true })
    const kiosk = await shop.getKioskProducts({ showAll: true })
    assert.include(ids(all), kept.id)
    assert.notInclude(ids(all), archived.id)
    assert.notInclude(ids(kiosk), archived.id)
  })

  test('recommendations skip them even when a precomputed row exists', async ({ assert }) => {
    const { supplier, product } = await setup()
    const buyer = await UserFactory.create()
    // In stock, so only the archive can be what hides it.
    await DeliveryFactory.merge({ supplierId: supplier.id, productId: product.id }).create()
    await db.table('recommendations').insert({
      user_id: buyer.id,
      product_id: product.id,
      score: 1,
      model: 'statistical',
      rank: 1,
      generated_at: new Date(),
      created_at: new Date(),
    })
    const recommendations = new RecommendationService()
    assert.deepEqual(await recommendations.getRecommendedIds(buyer.id), [product.id])

    await Product.query().where('id', product.id).update({ archived_at: new Date() })
    assert.deepEqual(await recommendations.getRecommendedIds(buyer.id), [])
  })
})
