import '#tests/test_context'
import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { InvoiceFactory } from '#database/factories/invoice_factory'
import { OrderFactory } from '#database/factories/order_factory'
import Invoice from '#models/invoice'
import Product from '#models/product'
import Allergen from '#models/allergen'
import db from '@adonisjs/lucid/services/db'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('user_favorites').delete()
  await db.from('orders').delete()
  await db.from('invoices').delete()
  await db.from('deliveries').delete()
  await db.from('product_allergen').delete()
  await db.from('products').delete()
  await db.from('allergens').delete()
  await db.from('categories').delete()
  await db.from('auth_access_tokens').delete()
  await db.from('users').delete()
}

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

  test('creating product redirects to stock with preselected product id', async ({
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
    assert.match(location, /^\/supplier\/stock\?preselect=\d+$/)

    const match = location.match(/preselect=(\d+)/)
    assert.isNotNull(match)

    const productId = Number(match![1])
    const product = await Product.find(productId)
    assert.isNotNull(product)
  })

  test('updating product via PUT persists changes and redirects to stock', async ({
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
    assert.equal(response.header('location'), '/supplier/stock')

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

  test('stock page returns preselect value from query string', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client
      .get('/supplier/stock?preselect=42')
      .loginAs(supplier)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')

    response.assertStatus(200)
    assert.equal(response.body().props.preselect, 42)
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

    const productId = Number(response.header('location')!.match(/preselect=(\d+)/)![1])
    const product = await Product.findOrFail(productId)
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

test.group('Web Supplier - deliveries (stocking)', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('POST /supplier/deliveries creates the stock row', async ({ client, assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()

    const response = await client
      .post('/supplier/deliveries')
      .loginAs(supplier)
      .withCsrfToken()
      .form({ productId: product.id, amount: 3, price: 49 })
      .redirects(0)

    response.assertStatus(302)

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
  })

  test('POST /supplier/deliveries rejects a zero price and stocks nothing', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()

    const response = await client
      .post('/supplier/deliveries')
      .loginAs(supplier)
      .withCsrfToken()
      .form({ productId: product.id, amount: 3, price: 0 })
      .redirects(0)

    response.assertStatus(302)

    const rows = await db.from('deliveries').where('product_id', product.id)
    assert.lengthOf(rows, 0)
  })

  test('a customer cannot stock products', async ({ client, assert }) => {
    const customer = await UserFactory.create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()

    const response = await client
      .post('/supplier/deliveries')
      .loginAs(customer)
      .withCsrfToken()
      .form({ productId: product.id, amount: 3, price: 49 })
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.header('location'), '/')

    const rows = await db.from('deliveries').where('product_id', product.id)
    assert.lengthOf(rows, 0)
  })
})
