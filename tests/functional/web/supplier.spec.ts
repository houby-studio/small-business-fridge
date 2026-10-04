import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { InvoiceFactory } from '#database/factories/invoice_factory'
import { OrderFactory } from '#database/factories/order_factory'
import Invoice from '#models/invoice'
import Product from '#models/product'
import Allergen from '#models/allergen'
import StockDraft from '#models/stock_draft'
import StockDraftItem from '#models/stock_draft_item'
import StockDraftService from '#services/shopping/stock_draft_service'
import db from '@adonisjs/lucid/services/db'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('user_favorites').delete()
  await db.from('orders').delete()
  await db.from('invoices').delete()
  await db.from('stock_draft_items').delete()
  await db.from('stock_drafts').delete()
  await db.from('deliveries').delete()
  await db.from('product_allergen').delete()
  await db.from('products').delete()
  await db.from('allergens').delete()
  await db.from('categories').delete()
  await db.from('auth_access_tokens').delete()
  await db.from('users').delete()
}

const inertia = { 'X-Inertia': 'true', 'X-Inertia-Version': '1' }

test.group('Web Supplier - stock index', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('supplier can view stock page', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client.get('/supplier/stock').loginAs(supplier)
    response.assertStatus(200)
  })

  test('customer cannot access stock page', async ({ client }) => {
    const customer = await UserFactory.create()
    const response = await client.get('/supplier/stock').loginAs(customer).redirects(0)
    response.assertStatus(302)
  })

  test('stock page returns paginated stock with filters', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({
      categoryId: category.id,
      displayName: 'Cola Zero',
    }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountSupplied: 10,
      amountLeft: 5,
      price: 25,
    }).create()

    const response = await client.get('/supplier/stock?name=Cola').loginAs(supplier)
    response.assertStatus(200)
  })

  test('stock page inStock filter returns 200', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client.get('/supplier/stock?inStock=1').loginAs(supplier)
    response.assertStatus(200)
  })

  test('stock page sortBy totalRemaining returns 200', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client
      .get('/supplier/stock?sortBy=totalRemaining&sortOrder=asc')
      .loginAs(supplier)
    response.assertStatus(200)
  })

  test('the stock table is sorted by product name A→Z by default', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    for (const displayName of ['Zebra', 'Ananas', 'Mango']) {
      const product = await ProductFactory.merge({ categoryId: category.id, displayName }).create()
      await DeliveryFactory.merge({
        supplierId: supplier.id,
        productId: product.id,
        amountLeft: 5,
        price: 10,
      }).create()
    }

    const response = await client.get('/supplier/stock').loginAs(supplier).headers(inertia)
    response.assertStatus(200)
    const { stock, filters } = response.body().props
    assert.deepEqual(
      stock.data.map((row: any) => row.productName),
      ['Ananas', 'Mango', 'Zebra']
    )
    assert.equal(filters.sortBy, 'productName')
    assert.equal(filters.sortOrder, 'asc')

    const reversed = await client
      .get('/supplier/stock?sortBy=productName&sortOrder=desc')
      .loginAs(supplier)
      .headers(inertia)
    assert.equal(reversed.body().props.stock.data[0].productName, 'Zebra')
  })

  test('stockState narrows the table while lowStockCount counts the whole scope', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const ids: Record<string, number> = {}
    for (const [name, left] of [
      ['Out', 0],
      ['Low', 3],
      ['Fine', 20],
    ] as const) {
      const product = await ProductFactory.merge({
        categoryId: category.id,
        displayName: name,
      }).create()
      ids[name] = product.id
      await DeliveryFactory.merge({
        supplierId: supplier.id,
        productId: product.id,
        amountSupplied: 20,
        amountLeft: left,
        price: 10,
      }).create()
    }

    const all = await client.get('/supplier/stock').loginAs(supplier).headers(inertia)
    assert.equal(all.body().props.stock.meta.total, 3)
    assert.equal(all.body().props.stock.lowStockCount, 2)
    assert.equal(all.body().props.filters.stockState, 'all')

    const low = await client
      .get('/supplier/stock?stockState=low')
      .loginAs(supplier)
      .headers(inertia)
    assert.deepEqual(
      low.body().props.stock.data.map((row: any) => row.productId),
      [ids.Low]
    )
    assert.equal(low.body().props.stock.lowStockCount, 2)
    assert.equal(low.body().props.stock.totals.totalProducts, 3)
    assert.equal(low.body().props.filters.stockState, 'low')

    const out = await client
      .get('/supplier/stock?stockState=out')
      .loginAs(supplier)
      .headers(inertia)
    assert.deepEqual(
      out.body().props.stock.data.map((row: any) => row.productId),
      [ids.Out]
    )
  })

  test('the stock page carries only what the table needs', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client.get('/supplier/stock').loginAs(supplier).headers(inertia)
    response.assertStatus(200)
    const props = response.body().props
    for (const key of ['stock', 'categories', 'filters', 'openDraftCount', 'incomeLimit']) {
      assert.property(props, key)
    }
    for (const gone of [
      'products',
      'recentDeliveries',
      'preselect',
      'marginPercent',
      'openDrafts',
    ]) {
      assert.notProperty(props, gone)
    }
    assert.deepEqual(props.filters, {
      categoryId: '',
      sortBy: 'productName',
      sortOrder: 'asc',
      scope: 'all',
      stockState: 'all',
    })
    assert.deepEqual(props.stock.totals, {
      totalProducts: 0,
      totalRemaining: 0,
      totalStockValue: 0,
    })
  })

  test('openDraftCount is shared with every page and counts only drafts with lines', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await StockDraft.create({ supplierId: supplier.id, source: 'web', status: 'open' })
    const filled = await StockDraft.create({
      supplierId: supplier.id,
      source: 'mcp',
      status: 'open',
    })
    await StockDraftItem.create({
      stockDraftId: filled.id,
      productId: product.id,
      amount: 2,
      price: 10,
      sortOrder: 0,
    })

    const stock = await client.get('/supplier/stock').loginAs(supplier).headers(inertia)
    assert.equal(stock.body().props.openDraftCount, 1)
    // Shared props: the nav badge works on any page.
    const products = await client.get('/supplier/products').loginAs(supplier).headers(inertia)
    assert.equal(products.body().props.openDraftCount, 1)

    const customer = await UserFactory.create()
    const shop = await client.get('/shop').loginAs(customer).headers(inertia)
    assert.equal(shop.body().props.openDraftCount, 0)
  })

  test('stock page defaults to store-wide scope', async ({ client, assert }) => {
    const supplierA = await UserFactory.apply('supplier').create()
    const supplierB = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const productA = await ProductFactory.merge({
      categoryId: category.id,
      displayName: 'A',
    }).create()
    const productB = await ProductFactory.merge({
      categoryId: category.id,
      displayName: 'B',
    }).create()

    await DeliveryFactory.merge({
      supplierId: supplierA.id,
      productId: productA.id,
      amountSupplied: 5,
      amountLeft: 5,
      price: 10,
    }).create()
    await DeliveryFactory.merge({
      supplierId: supplierB.id,
      productId: productB.id,
      amountSupplied: 5,
      amountLeft: 5,
      price: 10,
    }).create()

    const response = await client
      .get('/supplier/stock')
      .loginAs(supplierA)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')
    response.assertStatus(200)

    const rows: any[] = response.body().props.stock.data
    const productIds = rows.map((row) => row.productId)
    assert.includeMembers(productIds, [productA.id, productB.id])
  })

  test('stock page supports scope=mine filter', async ({ client, assert }) => {
    const supplierA = await UserFactory.apply('supplier').create()
    const supplierB = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const productA = await ProductFactory.merge({
      categoryId: category.id,
      displayName: 'A',
    }).create()
    const productB = await ProductFactory.merge({
      categoryId: category.id,
      displayName: 'B',
    }).create()

    await DeliveryFactory.merge({
      supplierId: supplierA.id,
      productId: productA.id,
      amountSupplied: 5,
      amountLeft: 5,
      price: 10,
    }).create()
    await DeliveryFactory.merge({
      supplierId: supplierB.id,
      productId: productB.id,
      amountSupplied: 5,
      amountLeft: 5,
      price: 10,
    }).create()

    const response = await client
      .get('/supplier/stock?scope=mine')
      .loginAs(supplierA)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')
    response.assertStatus(200)

    const rows: any[] = response.body().props.stock.data
    const productIds = rows.map((row) => row.productId)
    assert.include(productIds, productA.id)
    assert.notInclude(productIds, productB.id)
  })
})

test.group('Web Supplier - products', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('creating a product opens the stocking draft with it as a prefilled line', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const pngImage = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0JkAAAAASUVORK5CYII=',
      'base64'
    )

    const response = await client
      .post('/supplier/products')
      .loginAs(supplier)
      .withCsrfToken()
      .field('displayName', 'Prefill Product')
      .field('description', 'Auto prefill after create')
      .field('categoryId', category.id)
      .field('barcode', '123456789')
      .field('allergenIds', JSON.stringify([]))
      .file('image', pngImage, {
        filename: 'prefill.png',
        contentType: 'image/png',
      })
      .redirects(0)

    response.assertStatus(302)
    const location = response.header('location') || ''
    const match = location.match(/^\/supplier\/stock\/drafts\/(\d+)\?focus=(\d+)$/)
    assert.isNotNull(match, location)

    const product = await Product.findByOrFail('displayName', 'Prefill Product')
    const draft = await StockDraft.findOrFail(Number(match![1]))
    assert.equal(draft.supplierId, supplier.id)
    assert.equal(draft.source, 'web')
    const item = await StockDraftItem.findOrFail(Number(match![2]))
    assert.equal(item.stockDraftId, draft.id)
    assert.equal(item.productId, product.id)
    assert.equal(item.amount, 1)
  })

  test('a product created from a draft line lands in that line, a stale draft falls back', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const drafts = new StockDraftService()
    const draft = await drafts.create(supplier.id, {
      source: 'shopping_list',
      items: [{ label: 'Bake rolls', amount: 6, purchasePrice: 21.9 }],
    })
    const pngImage = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0JkAAAAASUVORK5CYII=',
      'base64'
    )
    const post = (name: string, draftId: number) =>
      client
        .post('/supplier/products')
        .loginAs(supplier)
        .withCsrfToken()
        .field('displayName', name)
        .field('description', 'Z příjemky')
        .field('categoryId', category.id)
        .field('allergenIds', JSON.stringify([]))
        .field('draftId', draftId)
        .field('lineIndex', 0)
        .file('image', pngImage, { filename: 'line.png', contentType: 'image/png' })
        .redirects(0)

    const response = await post('Bake Rolls česnek', draft.id)
    response.assertStatus(302)
    const product = await Product.findByOrFail('displayName', 'Bake Rolls česnek')
    const items = await StockDraftItem.query().where('stockDraftId', draft.id)
    assert.lengthOf(items, 1)
    assert.equal(items[0].productId, product.id)
    assert.equal(items[0].amount, 6)
    assert.equal(
      response.header('location'),
      `/supplier/stock/drafts/${draft.id}?focus=${items[0].id}`
    )

    // The draft was stocked or discarded meanwhile: the product still has somewhere to go.
    await drafts.discard(supplier, draft.id)
    const fallback = await post('Bake Rolls sýr', draft.id)
    fallback.assertStatus(302)
    const location = fallback.header('location') || ''
    const match = location.match(/^\/supplier\/stock\/drafts\/(\d+)\?focus=\d+$/)
    assert.isNotNull(match, location)
    assert.notEqual(Number(match![1]), draft.id)
    const fallbackDraft = await StockDraft.findOrFail(Number(match![1]))
    assert.equal(fallbackDraft.source, 'web')
  })

  test('updating product via PUT persists changes and returns to the product list', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({
      categoryId: category.id,
      displayName: 'Před úpravou',
    }).create()

    const response = await client
      .put(`/supplier/products/${product.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .field('displayName', 'Po úpravě')
      .field('description', 'Nový popis')
      .field('categoryId', category.id)
      .field('barcode', '987654321')
      .field('allergenIds', JSON.stringify([]))
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/supplier/products')

    await product.refresh()
    assert.equal(product.displayName, 'Po úpravě')
    assert.equal(product.description, 'Nový popis')
    assert.equal(product.barcode, '987654321')
  })

  test('product update is not routable as POST with _method in the body', async ({ client }) => {
    // AdonisJS only honours `_method` spoofing from the query string, and the
    // bodyparser runs after route matching — so a body-only `_method` 404s.
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()

    const response = await client
      .post(`/supplier/products/${product.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .field('displayName', 'Spoofed')
      .field('description', 'Spoofed')
      .field('categoryId', category.id)
      .field('_method', 'PUT')
      .redirects(0)

    response.assertStatus(404)
  })
})

test.group('Web Supplier - invoice index and generate', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('supplier can view invoice page', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client.get('/supplier/invoice').loginAs(supplier)
    response.assertStatus(200)
  })

  test('customer cannot access supplier invoice page', async ({ client }) => {
    const customer = await UserFactory.create()
    const response = await client.get('/supplier/invoice').loginAs(customer).redirects(0)
    response.assertStatus(302)
  })

  test('generate creates invoices for uninvoiced orders', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 5,
      price: 30,
    }).create()

    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()
    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()

    const response = await client
      .post('/supplier/invoice/generate')
      .loginAs(supplier)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/supplier/invoice')

    const invoice = await Invoice.query()
      .where('supplierId', supplier.id)
      .where('buyerId', buyer.id)
      .first()

    assert.isNotNull(invoice)
    assert.equal(invoice!.totalCost, 60) // 2 × 30
  })

  test('generate with no uninvoiced orders redirects with info flash', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()

    const response = await client
      .post('/supplier/invoice/generate')
      .loginAs(supplier)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/supplier/invoice')

    const invoiceCount = await Invoice.query().where('supplierId', supplier.id).count('* as total')
    assert.equal(Number(invoiceCount[0].$extras.total), 0)
  })

  test('admin can also generate invoices (has supplier access)', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: admin.id,
      productId: product.id,
      amountLeft: 3,
      price: 10,
    }).create()

    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()

    const response = await client
      .post('/supplier/invoice/generate')
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    const invoice = await Invoice.query().where('supplierId', admin.id).first()
    assert.isNotNull(invoice)
  })
})

test.group('Web Supplier - generate invoice for single buyer', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('supplier can generate invoice for a specific buyer', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery = await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 5,
      price: 30,
    }).create()

    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id }).create()

    const response = await client
      .post(`/supplier/invoice/generate/${buyer.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/supplier/invoice')

    const invoice = await Invoice.query()
      .where('supplierId', supplier.id)
      .where('buyerId', buyer.id)
      .first()

    assert.isNotNull(invoice)
    assert.equal(invoice!.totalCost, 30)
  })

  test('generate for buyer with no orders redirects with info flash', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()

    const response = await client
      .post(`/supplier/invoice/generate/${buyer.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/supplier/invoice')

    const count = await Invoice.query().where('supplierId', supplier.id).count('* as total')
    assert.equal(Number(count[0].$extras.total), 0)
  })

  test('customer cannot call generate for buyer endpoint', async ({ client }) => {
    const customer = await UserFactory.create()
    const buyer = await UserFactory.create()

    const response = await client
      .post(`/supplier/invoice/generate/${buyer.id}`)
      .loginAs(customer)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    // Role middleware redirects customers away from supplier routes
  })

  test('generate for buyer only invoices calling supplier orders, not other suppliers', async ({
    client,
    assert,
  }) => {
    const supplier1 = await UserFactory.apply('supplier').create()
    const supplier2 = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const category = await CategoryFactory.create()

    const product1 = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery1 = await DeliveryFactory.merge({
      supplierId: supplier1.id,
      productId: product1.id,
      amountLeft: 5,
      price: 10,
    }).create()

    const product2 = await ProductFactory.merge({ categoryId: category.id }).create()
    const delivery2 = await DeliveryFactory.merge({
      supplierId: supplier2.id,
      productId: product2.id,
      amountLeft: 5,
      price: 20,
    }).create()

    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery1.id }).create()
    await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery2.id }).create()

    // supplier1 generates invoice for buyer
    const response = await client
      .post(`/supplier/invoice/generate/${buyer.id}`)
      .loginAs(supplier1)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    // Only supplier1's invoice should exist
    const invoice1 = await Invoice.query()
      .where('supplierId', supplier1.id)
      .where('buyerId', buyer.id)
      .first()
    assert.isNotNull(invoice1)
    assert.equal(invoice1!.totalCost, 10) // only supplier1's order

    // supplier2's order must still be uninvoiced
    const invoice2 = await Invoice.query()
      .where('supplierId', supplier2.id)
      .where('buyerId', buyer.id)
      .first()
    assert.isNull(invoice2)
  })
})

test.group('Web Supplier - payments status filter', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('filter by status=awaiting returns 200', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client.get('/supplier/payments?status=awaiting').loginAs(supplier)
    response.assertStatus(200)
  })

  test('filter by status=paid returns 200', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    await InvoiceFactory.apply('paid')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client.get('/supplier/payments?status=paid').loginAs(supplier)
    response.assertStatus(200)
  })
})

test.group('Web Supplier - payments (approve/reject)', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('supplier can view payments page', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client.get('/supplier/payments').loginAs(supplier)
    response.assertStatus(200)
  })

  test('supplier can approve a payment request', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client
      .post(`/supplier/payments/${invoice.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ action: 'approve' })
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/supplier/payments')

    await invoice.refresh()
    assert.isTrue(invoice.isPaid)

    const log = await db
      .from('audit_logs')
      .where('action', 'payment.approved')
      .where('user_id', supplier.id)
      .where('entity_type', 'invoice')
      .where('entity_id', invoice.id)
      .first()
    assert.isDefined(log)
    const metadata = log.metadata as {
      isPaid?: { from: boolean; to: boolean }
      wasRequestedByCustomer?: boolean
    } | null
    assert.deepEqual(metadata?.isPaid, { from: false, to: true })
    assert.isTrue(metadata?.wasRequestedByCustomer)
  })

  test('supplier can reject a payment request', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client
      .post(`/supplier/payments/${invoice.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ action: 'reject' })
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/supplier/payments')

    await invoice.refresh()
    assert.isFalse(invoice.isPaid)
    assert.isFalse(invoice.isPaymentRequested)
  })

  test("supplier cannot approve another supplier's invoice", async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const otherSupplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client
      .post(`/supplier/payments/${invoice.id}`)
      .loginAs(otherSupplier)
      .withCsrfToken()
      .json({ action: 'approve' })
      .redirects(0)

    response.assertStatus(302)

    // Invoice should not be paid
    await invoice.refresh()
    assert.isFalse(invoice.isPaid)
    assert.isTrue(invoice.isPaymentRequested)
  })

  test('customer cannot access payment actions', async ({ client, assert }) => {
    const customer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client
      .post(`/supplier/payments/${invoice.id}`)
      .loginAs(customer)
      .withCsrfToken()
      .json({ action: 'approve' })
      .redirects(0)

    // 302 is also what success returns, so the status alone proves nothing: assert the
    // redirect target of the role middleware AND that the invoice was left alone.
    response.assertStatus(302)
    assert.equal(response.header('location'), '/')

    await invoice.refresh()
    assert.isFalse(invoice.isPaid)
  })

  test('approve action requires valid action field', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()

    const response = await client
      .post(`/supplier/payments/${invoice.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ action: 'invalid_action' })
      .redirects(0)

    // Web route: validation failure redirects back (not 422)
    assert.notEqual(response.status(), 200)

    // Invoice should not have changed
    await invoice.refresh()
    assert.isFalse(invoice.isPaid)
  })
})

test.group('Web Supplier - payments ordering and redirect', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('payments page lists awaiting, then unpaid, then paid invoices', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const now = DateTime.now()

    const paid = await InvoiceFactory.apply('paid')
      .merge({ buyerId: buyer.id, supplierId: supplier.id, createdAt: now })
      .create()
    const unpaid = await InvoiceFactory.merge({
      buyerId: buyer.id,
      supplierId: supplier.id,
      createdAt: now.minus({ days: 1 }),
    }).create()
    const awaiting = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id, createdAt: now.minus({ days: 2 }) })
      .create()

    const response = await client
      .get('/supplier/payments')
      .loginAs(supplier)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')
    response.assertStatus(200)

    const rows: any[] = response.body().props.invoices.data
    assert.deepEqual(
      rows.map((row) => row.id),
      [awaiting.id, unpaid.id, paid.id]
    )
    // Buyer preload must survive the users join used for the name tiebreaker.
    assert.equal(rows[0].buyer.id, buyer.id)
    assert.equal(rows[0].buyer.displayName, buyer.displayName)
  })

  test('approving from a filtered, paginated list redirects back to that exact list', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const invoice = await InvoiceFactory.apply('paymentRequested')
      .merge({ buyerId: buyer.id, supplierId: supplier.id })
      .create()
    const listUrl = '/supplier/payments?status=awaiting&sortBy=totalCost&sortOrder=asc&page=2'

    const response = await client
      .post(`/supplier/payments/${invoice.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .header('referer', listUrl)
      .json({ action: 'approve' })
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), listUrl)

    await invoice.refresh()
    assert.isTrue(invoice.isPaid)
  })
})

test.group('Web Supplier - product allergens', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  const pngImage = () =>
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0JkAAAAASUVORK5CYII=',
      'base64'
    )

  test('allergens picked in the create form are actually stored', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const gluten = await Allergen.create({ name: 'Lepek', isDisabled: false })
    const milk = await Allergen.create({ name: 'Mléko', isDisabled: false })

    // Exactly how Inertia serialises an array into FormData: indexed keys, values as strings.
    const response = await client
      .post('/supplier/products')
      .loginAs(supplier)
      .withCsrfToken()
      .field('displayName', 'Sušenka')
      .field('description', 'Obsahuje alergeny')
      .field('categoryId', category.id)
      .field('allergenIds[0]', String(gluten.id))
      .field('allergenIds[1]', String(milk.id))
      .file('image', pngImage(), { filename: 'cookie.png', contentType: 'image/png' })
      .redirects(0)

    response.assertStatus(302)

    const product = await Product.findByOrFail('displayName', 'Sušenka')
    await product.load('allergens')
    assert.deepEqual(
      product.allergens.map((a) => a.id).sort((a, b) => a - b),
      [gluten.id, milk.id].sort((a, b) => a - b)
    )
  })

  test('editing a product can add and then clear its allergens', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const nuts = await Allergen.create({ name: 'Orechy', isDisabled: false })
    const product = await ProductFactory.merge({ categoryId: category.id }).create()

    const added = await client
      .put(`/supplier/products/${product.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .field('displayName', product.displayName)
      .field('description', 'S orechy')
      .field('categoryId', category.id)
      .field('allergenIds', JSON.stringify([nuts.id]))
      .redirects(0)

    added.assertStatus(302)
    await product.load('allergens')
    assert.deepEqual(
      product.allergens.map((a) => a.id),
      [nuts.id]
    )

    // Deselecting every allergen sends an empty JSON array — that is exactly why the form
    // serialises this field as JSON instead of relying on FormData keys.
    const cleared = await client
      .put(`/supplier/products/${product.id}`)
      .loginAs(supplier)
      .withCsrfToken()
      .field('displayName', product.displayName)
      .field('description', 'Bez orechu')
      .field('categoryId', category.id)
      .field('allergenIds', JSON.stringify([]))
      .redirects(0)

    cleared.assertStatus(302)
    await product.load('allergens')
    assert.lengthOf(product.allergens, 0)
  })
})

test.group('Web Supplier - stocking through a draft', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  async function openDraft(client: any, supplier: any) {
    const created = await client
      .post('/supplier/stock/drafts')
      .loginAs(supplier)
      .withCsrfToken()
      .redirects(0)
    created.assertStatus(302)
    return Number(created.header('location')!.match(/drafts\/(\d+)/)![1])
  }

  test('committing a draft creates the stock row and the audit entry', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const draftId = await openDraft(client, supplier)

    const response = await client
      .post(`/supplier/stock/drafts/${draftId}/commit`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ items: [{ productId: product.id, amount: 3, price: 49 }] })
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/supplier/stock')

    const row = await db
      .from('deliveries')
      .where('supplier_id', supplier.id)
      .where('product_id', product.id)
      .first()
    assert.exists(row)
    assert.equal(Number(row.amount_supplied), 3)
    assert.equal(Number(row.amount_left), 3)
    assert.equal(Number(row.price), 49)

    const log = await db
      .from('audit_logs')
      .where('user_id', supplier.id)
      .where('action', 'delivery.created')
      .first()
    assert.exists(log)
    assert.isNull(log.target_user_id)
  })

  test('a zero price is rejected and stocks nothing', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    const draftId = await openDraft(client, supplier)

    const response = await client
      .post(`/supplier/stock/drafts/${draftId}/commit`)
      .loginAs(supplier)
      .withCsrfToken()
      .json({ items: [{ productId: product.id, amount: 3, price: 0 }] })
      .redirects(0)

    response.assertStatus(302)
    assert.lengthOf(await db.from('deliveries').where('product_id', product.id), 0)
    const draft = await StockDraft.findOrFail(draftId)
    assert.equal(draft.status, 'open')
  })

  test('a customer cannot start a draft, and the old quick-form route is gone', async ({
    client,
    assert,
  }) => {
    const customer = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()

    const refused = await client
      .post('/supplier/stock/drafts')
      .loginAs(customer)
      .withCsrfToken()
      .redirects(0)
    refused.assertStatus(302)
    assert.equal(refused.header('location'), '/')
    assert.lengthOf(await StockDraft.all(), 0)

    const gone = await client
      .post('/supplier/deliveries')
      .loginAs(supplier)
      .withCsrfToken()
      .form({ productId: product.id, amount: 3, price: 49 })
      .redirects(0)
    gone.assertStatus(404)
    assert.lengthOf(await db.from('deliveries').where('product_id', product.id), 0)
  })
})
