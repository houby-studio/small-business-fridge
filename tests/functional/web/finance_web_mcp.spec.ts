import '#tests/test_context'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import env from '#start/env'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { store as throttleStore } from '#middleware/throttle_middleware'
import Delivery from '#models/delivery'
import Invoice from '#models/invoice'
import User from '#models/user'
import InventoryService from '#services/inventory_service'

/**
 * F-F1 / F-F2 — the finance page and the MCP tools report the same money, and only the
 * caller's: the web `/supplier/finance`, MCP `get_finance_summary` (with byProduct) and the
 * billing preview (`/supplier/invoice`, MCP `uninvoiced_summary`) for two suppliers selling to
 * the same people. Expected numbers are worked out by hand below.
 */

const inertia = { 'x-inertia': 'true', 'x-inertia-version': '1' }

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

async function token(user: User) {
  const created = await User.accessTokens.create(user, ['*'], {
    name: 'finance-mcp',
    expiresIn: '1 day',
  })
  return created.value!.release()
}

/** Calls one MCP tool and returns its JSON payload (or the error text). */
async function callTool(client: ApiClient, bearer: string, name: string, args = {}) {
  const response = await client
    .post('/mcp')
    .header('Authorization', `Bearer ${bearer}`)
    .header('Accept', 'application/json, text/event-stream')
    .header('Content-Type', 'application/json')
    .json({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  response.assertStatus(200)
  const text = response.text()
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'))
  const message = JSON.parse(line ? line.slice(5) : text)
  const content: string = message.result.content[0].text
  return { isError: message.result.isError === true, data: safeJson(content), raw: content }
}

function safeJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function sell(deliveryId: number, buyerId: number, count: number, price: number) {
  await db.table('orders').multiInsert(
    Array.from({ length: count }, () => ({
      buyer_id: buyerId,
      delivery_id: deliveryId,
      channel: 'web',
      unit_price: price,
      created_at: new Date(),
      updated_at: new Date(),
    }))
  )
}

/**
 * Two suppliers, one fridge. A: cola lot (price 20, cost 12.50) and a bar lot without a
 * purchase price (price 30). B: a water lot (price 15, cost 10), stocked two years ago.
 * Sales this year — on A's lots: Petr 3 colas, Jana 1 cola + 2 bars, B 1 cola, A 2 colas
 * (own consumption); on B's lot: Petr 4 waters, A 1 water. A writes off 1 bar (stolen),
 * B 2 waters (expired). Jana's colas and bars are invoiced, unpaid; Petr paid B 60.
 */
async function twoSuppliers() {
  const a = await UserFactory.apply('supplier').create()
  const b = await UserFactory.apply('supplier').create()
  const petr = await UserFactory.merge({ displayName: 'Petr' }).create()
  const jana = await UserFactory.merge({ displayName: 'Jana' }).create()
  const category = await CategoryFactory.create()
  const cola = await ProductFactory.merge({ categoryId: category.id, displayName: 'Cola' }).create()
  const bar = await ProductFactory.merge({
    categoryId: category.id,
    displayName: 'Tyčinka',
  }).create()
  const water = await ProductFactory.merge({
    categoryId: category.id,
    displayName: 'Voda',
  }).create()

  const colaLot = await Delivery.create({
    supplierId: a.id,
    productId: cola.id,
    amountSupplied: 20,
    amountLeft: 20 - 7,
    amountLost: 0,
    price: 20,
    purchasePrice: 12.5,
  })
  const barLot = await Delivery.create({
    supplierId: a.id,
    productId: bar.id,
    amountSupplied: 5,
    amountLeft: 5 - 2,
    amountLost: 0,
    price: 30,
    purchasePrice: null,
  })
  const waterLot = await Delivery.create({
    supplierId: b.id,
    productId: water.id,
    amountSupplied: 10,
    amountLeft: 10 - 5,
    amountLost: 0,
    price: 15,
    purchasePrice: 10,
    createdAt: DateTime.now().minus({ years: 2 }),
  })
  await sell(colaLot.id, petr.id, 3, 20)
  await sell(colaLot.id, jana.id, 1, 20)
  await sell(barLot.id, jana.id, 2, 30)
  await sell(colaLot.id, b.id, 1, 20)
  await sell(colaLot.id, a.id, 2, 20)
  await sell(waterLot.id, petr.id, 4, 15)
  await sell(waterLot.id, a.id, 1, 15)
  const inventory = new InventoryService()
  await inventory.writeOff(a, { productId: bar.id, quantity: 1, reason: 'stolen' })
  await inventory.writeOff(b, { productId: water.id, quantity: 2, reason: 'expired' })

  const janaInvoice = await Invoice.create({
    buyerId: jana.id,
    supplierId: a.id,
    totalCost: 80,
    isPaid: false,
    isPaymentRequested: false,
    paidAt: null,
  })
  await db
    .from('orders')
    .where('buyer_id', jana.id)
    .whereIn('delivery_id', [colaLot.id, barLot.id])
    .update({ invoice_id: janaInvoice.id })
  const petrPaidB = await Invoice.create({
    buyerId: petr.id,
    supplierId: b.id,
    totalCost: 60,
    isPaid: true,
    isPaymentRequested: true,
    paidAt: DateTime.now(),
  })
  await db
    .from('orders')
    .where('buyer_id', petr.id)
    .where('delivery_id', waterLot.id)
    .update({ invoice_id: petrPaidB.id })
  return { a, b, petr, jana, cola, bar, water }
}

test.group('Finance — the web page and MCP report the same money, only mine', (group) => {
  let previousLimit: number | undefined
  group.each.setup(async () => {
    previousLimit = env.get('SUPPLIER_INCOME_LIMIT')
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(async () => {
    env.set('SUPPLIER_INCOME_LIMIT', previousLimit ?? 0)
    await cleanAll()
  })

  // Mutations caught: a lost supplier filter (QA-01) on either channel; MCP computing its own
  // numbers or a different margin/year; byProduct paging or sort differing from the web.
  test('finance page and get_finance_summary agree to the heller and leave the colleague out', async ({
    client,
    assert,
  }) => {
    env.set('SUPPLIER_INCOME_LIMIT', 1000)
    const { a, b, cola, bar } = await twoSuppliers()
    a.marginPercent = 12.5
    await a.save()

    const page = await client.get('/supplier/finance').loginAs(a).headers(inertia)
    page.assertStatus(200)
    const { summary, products } = page.body().props

    // A's sales to others: Petr 3 + Jana 1 + B 1 colas (5 × 20) and Jana's 2 bars (2 × 30).
    assert.deepInclude(summary, {
      unitsSold: 7,
      revenue: 160,
      unitsWithCost: 5,
      revenueWithCost: 100,
      costOfSales: 62.5, // 5 × 12.50
      grossProfit: 37.5,
      unitsWithoutCost: 2,
      marginPercent: 12.5,
      netProfit: 37.5, // the stolen bar has no purchase price — nothing comes off
    })
    assert.deepEqual(summary.ownConsumption, { units: 2, value: 40 })
    assert.deepInclude(summary.shrinkage, { lostUnits: 1, lossCost: 30, lossValue: 30 })
    // Owed: Petr's 60 and B's 20 not invoiced, Jana's 80 invoiced and unpaid; nothing received.
    assert.deepInclude(summary.money, { uninvoiced: 80, unpaid: 80 })
    assert.deepInclude(summary.incomeLimit, { amount: 0, pending: 160, level: 'ok' })
    assert.deepEqual(
      products.data.map((row: any) => [row.productId, row.unitsSold, row.revenue, row.grossProfit]),
      [
        [cola.id, 5, 100, 37.5],
        [bar.id, 2, 60, null],
      ]
    )

    const bearer = await token(a)
    const mcp = await callTool(client, bearer, 'get_finance_summary', {
      byProduct: true,
      perPage: 20,
    })
    assert.isFalse(mcp.isError, mcp.raw)
    // Everything but the breakdown and the prose for the model (`note`/`hint`) is the summary.
    const { products: mcpProducts, productsMeta, ...rest } = mcp.data
    const mcpSummary = Object.fromEntries(
      Object.entries(rest).filter(([key]) => key !== 'note' && key !== 'hint')
    )
    assert.deepEqual(mcpSummary, summary)
    assert.deepEqual(mcpProducts, products.data)
    assert.deepEqual(productsMeta, products.meta)

    // B sees B's own: Petr's 4 waters, A's water — never A's colas, and Petr's 60 as received.
    const theirs = await client.get('/supplier/finance').loginAs(b).headers(inertia)
    assert.deepInclude(theirs.body().props.summary, { unitsSold: 5, revenue: 75, costOfSales: 50 })
    assert.deepInclude(theirs.body().props.summary.incomeLimit, { amount: 60, pending: 15 })
    assert.notInclude(
      theirs.body().props.products.data.map((row: any) => row.productId),
      cola.id
    )
  })

  // Mutations caught: the web accepting a year it has no data for, the year list built from
  // all suppliers' lots, MCP answering a year with somebody else's data.
  test('a year only the colleague has data for shows nothing of theirs', async ({
    client,
    assert,
  }) => {
    const { a } = await twoSuppliers()
    const current = DateTime.now().setZone('Europe/Prague').year
    const twoYearsAgo = current - 2

    const page = await client
      .get(`/supplier/finance?year=${twoYearsAgo}`)
      .loginAs(a)
      .headers(inertia)
    const props = page.body().props
    // A's first lot is this year: the only year on offer, and the request falls back to it.
    assert.deepEqual(props.years, [current])
    assert.equal(props.summary.year, current)
    assert.equal(props.filters.year, String(current))

    const garbage = await client.get('/supplier/finance?year=abc').loginAs(a).headers(inertia)
    assert.equal(garbage.body().props.summary.year, current)

    const mcp = await callTool(client, await token(a), 'get_finance_summary', {
      year: twoYearsAgo,
    })
    assert.isFalse(mcp.isError, mcp.raw)
    assert.deepInclude(mcp.data, { year: twoYearsAgo, unitsSold: 0, revenue: 0 })
    assert.equal(mcp.data.shrinkage.lostUnits, 0)
  })

  // Mutations caught: the preview without the supplier filter, isSelf on the wrong row, the
  // preview total counting own purchases, preview and finance page disagreeing.
  test('the billing preview lists only my buyers, flags my own purchases and matches the finance page', async ({
    client,
    assert,
  }) => {
    const { a, b, petr } = await twoSuppliers()

    const preview = await callTool(client, await token(a), 'uninvoiced_summary')
    assert.isFalse(preview.isError, preview.raw)
    // Not invoiced on A's lots: Petr 3 × 20, A 2 × 20 (own), B 1 × 20. Heaviest first.
    assert.deepEqual(
      preview.data.buyers.map((row: any) => [
        row.buyerId,
        row.orderCount,
        row.totalCost,
        row.isSelf,
      ]),
      [
        [petr.id, 3, 60, undefined],
        [a.id, 2, 40, true],
        [b.id, 1, 20, undefined],
      ]
    )
    assert.equal(preview.data.totalUninvoiced, 80)
    assert.equal(preview.data.ownConsumption, 40)

    const web = await client.get('/supplier/invoice').loginAs(a).headers(inertia)
    assert.deepEqual(
      web.body().props.uninvoiced.map((row: any) => [row.buyerId, row.totalCost]),
      preview.data.buyers.map((row: any) => [row.buyerId, row.totalCost])
    )
    const finance = await client.get('/supplier/finance').loginAs(a).headers(inertia)
    assert.equal(finance.body().props.summary.money.uninvoiced, preview.data.totalUninvoiced)

    // Approving the preview issues exactly that: three invoices, the own one paid, 80 owed.
    mail.fake()
    try {
      const issued = await callTool(client, await token(a), 'generate_invoices', {
        expectedTotal: preview.data.totalUninvoiced,
      })
      assert.isFalse(issued.isError, issued.raw)
      const after = await client.get('/supplier/finance').loginAs(a).headers(inertia)
      // 80 newly invoiced + Jana's 80 from before.
      assert.deepInclude(after.body().props.summary.money, { uninvoiced: 0, unpaid: 160 })
      assert.deepInclude(after.body().props.summary.incomeLimit, { amount: 0 })
    } finally {
      mail.restore()
    }
  })
})

test.group('Finance — the margin setting at its bounds (F-F2)', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  async function put(client: ApiClient, user: User, marginPercent: unknown) {
    return client
      .put('/supplier/finance/settings')
      .loginAs(user)
      .withCsrfToken()
      .header('referer', '/supplier/finance')
      .json({ marginPercent })
      .redirects(0)
  }
  const marginOf = async (id: number) => {
    const user = await User.findOrFail(id)
    return Number(user.marginPercent)
  }
  const audits = async () =>
    db.from('audit_logs').where('action', 'supplier.settings_updated').orderBy('id')

  // Mutations caught: min/max off by one step, more than two decimals accepted, an audit
  // written for a refused value or for a save that changed nothing.
  test('0 and 100 are saved; just past them, three decimals and text are refused', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()

    for (const valid of [100, 0, 33.33]) {
      const saved = await put(client, supplier, valid)
      saved.assertStatus(302)
      assert.equal(await marginOf(supplier.id), valid, `${valid} is a valid margin`)
    }
    for (const invalid of [100.01, -0.01, 5.555, 'abc', null]) {
      const refused = await put(client, supplier, invalid)
      refused.assertStatus(302)
      assert.equal(await marginOf(supplier.id), 33.33, `${invalid} must be refused`)
    }
    // Saving the same value again changes nothing and is not audited.
    const unchanged = await put(client, supplier, 33.33)
    unchanged.assertStatus(302)

    const logged = await audits()
    assert.deepEqual(
      logged.map((row) => row.metadata.marginPercent),
      [
        { from: 0, to: 100 },
        { from: 100, to: 0 },
        { from: 0, to: 33.33 },
      ]
    )
  })

  test('a customer cannot set a margin', async ({ client, assert }) => {
    const customer = await UserFactory.create()
    const response = await put(client, customer, 10)
    response.assertStatus(302)
    assert.equal(response.header('location'), '/')
    assert.equal(await marginOf(customer.id), 0)
    assert.lengthOf(await audits(), 0)
  })
})
