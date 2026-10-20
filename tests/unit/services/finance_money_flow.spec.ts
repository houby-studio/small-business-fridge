import '#tests/test_context'
import { test } from '@japa/runner'
import fc from 'fast-check'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Delivery from '#models/delivery'
import type User from '#models/user'
import FinanceService from '#services/finance_service'
import InvoiceService from '#services/invoice_service'
import OrderService from '#services/order_service'
import DeliveryService from '#services/delivery_service'
import AdminService from '#services/admin_service'
import { collectStockViolations } from '#tests/helpers/stock_invariants'

/**
 * Model-based test of the money of one supplier through its whole life: purchases (by
 * customers, a colleague and the supplier themself), invoicing all or one buyer, reporting,
 * approving and rejecting payments, storno and a price correction. A small model written
 * from the rules (not from the code) keeps every order and invoice; after each step:
 *
 * - received this year + still owed = everything other people bought (nothing is lost or
 *   counted twice between "not invoiced", "unpaid" and "paid");
 * - received = paid invoices of other people, at the totals they were issued with;
 * - an invoice total is the sum of its orders, and never changes after issuing;
 * - a self-invoice is paid when issued and is never income; `paid_at` is set iff paid;
 * - revenue = what others bought (at the price they really pay), own consumption apart;
 * - the uninvoiced preview (what MCP uninvoiced_summary and the web billing page show) per
 *   buyer equals the model, and its total without the supplier's own purchases equals the
 *   "uninvoiced" of the finance page;
 * - a colleague's lot and sales never leak in either direction.
 *
 * Catches: a self-invoice counted as income or as unpaid, approve/reject not moving the money,
 * an invoice issued twice for the same orders, a correction repricing invoiced orders,
 * storno of an invoiced order, the uninvoiced preview and the finance page disagreeing.
 */

const finance = new FinanceService()
const invoiceService = new InvoiceService()
const orderService = new OrderService()

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

interface ModelOrder {
  id: number
  buyer: number
  price: number
  invoice: number | null
}
interface ModelInvoice {
  id: number
  buyer: number
  total: number
  paid: boolean
}

type Op =
  | { kind: 'buy'; buyer: number }
  | { kind: 'buyColleague'; buyer: number }
  | { kind: 'invoiceAll' }
  | { kind: 'invoiceOne'; buyer: number }
  | { kind: 'request'; pick: number }
  | { kind: 'approve'; pick: number }
  | { kind: 'reject'; pick: number }
  | { kind: 'storno'; pick: number }
  | { kind: 'reprice'; price: number }

// Buyer indexes: 0, 1 = customers, 2 = the colleague (a supplier too), 3 = the supplier.
const buyerArb = fc.integer({ min: 0, max: 3 })
const pickArb = fc.nat({ max: 20 })
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: buyerArb.map((buyer) => ({ kind: 'buy' as const, buyer })) },
  { weight: 1, arbitrary: buyerArb.map((buyer) => ({ kind: 'buyColleague' as const, buyer })) },
  { weight: 2, arbitrary: fc.constant({ kind: 'invoiceAll' as const }) },
  { weight: 2, arbitrary: buyerArb.map((buyer) => ({ kind: 'invoiceOne' as const, buyer })) },
  { weight: 3, arbitrary: pickArb.map((pick) => ({ kind: 'request' as const, pick })) },
  { weight: 4, arbitrary: pickArb.map((pick) => ({ kind: 'approve' as const, pick })) },
  { weight: 3, arbitrary: pickArb.map((pick) => ({ kind: 'reject' as const, pick })) },
  { weight: 2, arbitrary: pickArb.map((pick) => ({ kind: 'storno' as const, pick })) },
  {
    weight: 1,
    arbitrary: fc
      .integer({ min: 15, max: 30 })
      .map((price) => ({ kind: 'reprice' as const, price })),
  }
)

const executed = new Map<string, number>()

async function runScenario(ops: Op[]) {
  await cleanAll()
  const supplier = await UserFactory.apply('supplier').create()
  const colleague = await UserFactory.apply('supplier').create()
  const admin = await UserFactory.apply('admin').create()
  const customers = [await UserFactory.create(), await UserFactory.create()]
  const buyers: User[] = [...customers, colleague, supplier]
  const category = await CategoryFactory.create()
  const cola = await ProductFactory.merge({ categoryId: category.id }).create()
  const chips = await ProductFactory.merge({ categoryId: category.id }).create()
  const myLot = await Delivery.create({
    supplierId: supplier.id,
    productId: cola.id,
    amountSupplied: 100,
    amountLeft: 100,
    amountLost: 0,
    price: 20,
    purchasePrice: 12,
  })
  const theirLot = await Delivery.create({
    supplierId: colleague.id,
    productId: chips.id,
    amountSupplied: 100,
    amountLeft: 100,
    amountLost: 0,
    price: 33,
    purchasePrice: null,
  })

  let lotPrice = 20
  const orders: ModelOrder[] = []
  const invoices: ModelInvoice[] = []
  const colleagueSales: number[] = []
  let colleagueOwn = 0

  const issue = (issued: Array<{ id: number; buyerId: number; totalCost: number }>) => {
    for (const invoice of issued) {
      const covered = orders.filter((o) => o.invoice === null && o.buyer === invoice.buyerId)
      for (const order of covered) order.invoice = invoice.id
      invoices.push({
        id: invoice.id,
        buyer: invoice.buyerId,
        total: covered.reduce((sum, o) => sum + o.price, 0),
        paid: invoice.buyerId === supplier.id,
      })
    }
  }
  const othersInvoices = () => invoices.filter((i) => i.buyer !== supplier.id)
  const count = (kind: string) => executed.set(kind, (executed.get(kind) ?? 0) + 1)

  for (const op of ops) {
    switch (op.kind) {
      case 'buy': {
        const order = await orderService.purchase(buyers[op.buyer].id, myLot.id, 'web')
        orders.push({ id: order.id, buyer: buyers[op.buyer].id, price: lotPrice, invoice: null })
        break
      }
      case 'buyColleague': {
        // The supplier, a customer or the colleague themself buys from the colleague's lot.
        const buyer = buyers[op.buyer]
        await orderService.purchase(buyer.id, theirLot.id, 'web')
        if (buyer.id === colleague.id) colleagueOwn++
        else colleagueSales.push(33)
        break
      }
      case 'invoiceAll': {
        const expected = new Set(orders.filter((o) => o.invoice === null).map((o) => o.buyer))
        const issued = await invoiceService.generateInvoices(supplier.id)
        if (
          issued
            .map((i) => i.buyerId)
            .sort()
            .join() !== [...expected].sort().join()
        ) {
          throw new Error(`invoiced buyers ${issued.map((i) => i.buyerId)} ≠ ${[...expected]}`)
        }
        issue(issued)
        break
      }
      case 'invoiceOne': {
        const buyerId = buyers[op.buyer].id
        const hasOpen = orders.some((o) => o.invoice === null && o.buyer === buyerId)
        const issued = await invoiceService.generateInvoiceForBuyer(supplier.id, buyerId)
        if (hasOpen !== (issued !== null)) throw new Error('invoice for one buyer ≠ model')
        if (issued) issue([issued])
        break
      }
      case 'request':
      case 'approve':
      case 'reject': {
        const candidates = othersInvoices()
        if (candidates.length === 0) continue
        const invoice = candidates[op.pick % candidates.length]
        if (op.kind === 'request') {
          try {
            await invoiceService.requestPayment(invoice.id, invoice.buyer)
          } catch (error) {
            if (!(error instanceof Error && error.message === 'ALREADY_PAID' && invoice.paid)) {
              throw error
            }
          }
        } else if (op.kind === 'approve') {
          await invoiceService.approvePayment(invoice.id, supplier.id)
          invoice.paid = true
        } else {
          await invoiceService.rejectPayment(invoice.id, supplier.id)
          invoice.paid = false
        }
        break
      }
      case 'storno': {
        if (orders.length === 0) continue
        const order = orders[op.pick % orders.length]
        try {
          await new AdminService().stornoOrder(order.id, admin.id)
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === 'ORDER_ALREADY_INVOICED' &&
            order.invoice
          ) {
            count('stornoRefused')
            continue
          }
          throw error
        }
        if (order.invoice !== null) throw new Error('an invoiced order was cancelled')
        orders.splice(orders.indexOf(order), 1)
        break
      }
      case 'reprice': {
        if (op.price === lotPrice) continue
        await myLot.refresh()
        await new DeliveryService().correctDelivery(supplier, myLot.id, {
          amount: myLot.amountSupplied,
          price: op.price,
          reason: 'cena opravena',
        })
        lotPrice = op.price
        for (const order of orders) if (order.invoice === null) order.price = op.price
        break
      }
    }
    count(op.kind)
    await checkMoney()
  }

  async function checkMoney() {
    const sum = (list: Array<{ price: number }>) => list.reduce((s, o) => s + o.price, 0)
    const toOthers = orders.filter((o) => o.buyer !== supplier.id)
    const own = orders.filter((o) => o.buyer === supplier.id)
    const receivedModel = othersInvoices()
      .filter((i) => i.paid)
      .reduce((s, i) => s + i.total, 0)
    const unpaidModel = othersInvoices()
      .filter((i) => !i.paid)
      .reduce((s, i) => s + i.total, 0)
    const uninvoicedModel = sum(toOthers.filter((o) => o.invoice === null))

    const received = await finance.receivedIn(supplier.id)
    const owed = await finance.owedNow(supplier.id)
    const summary = await finance.getSummary(supplier.id, finance.currentYear(), 0)
    const actual = {
      received,
      uninvoiced: owed.uninvoiced,
      unpaid: owed.unpaid,
      revenue: summary.revenue,
      unitsSold: summary.unitsSold,
      own: summary.ownConsumption,
      limit: [summary.incomeLimit.amount, summary.incomeLimit.pending],
    }
    const expected = {
      received: receivedModel,
      uninvoiced: uninvoicedModel,
      unpaid: unpaidModel,
      revenue: sum(toOthers),
      unitsSold: toOthers.length,
      own: { units: own.length, value: sum(own) },
      limit: [receivedModel, uninvoicedModel + unpaidModel],
    }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `money ≠ model\n actual   ${JSON.stringify(actual)}\n expected ${JSON.stringify(expected)}`
      )
    }
    // Conservation: everything others bought is received, unpaid or not invoiced yet.
    if (received + owed.unpaid + owed.uninvoiced !== sum(toOthers)) {
      throw new Error('received + owed ≠ sold to others')
    }

    // Invoices in the database: totals as issued, equal to their orders; paid_at iff paid.
    const rows = await db.rawQuery(
      `SELECT i.id, i.buyer_id, i.total_cost, i.is_paid, i.paid_at,
              COALESCE((SELECT SUM(o.unit_price) FROM orders o WHERE o.invoice_id = i.id), 0)::int AS orders_total
         FROM invoices i WHERE i.supplier_id = ? ORDER BY i.id`,
      [supplier.id]
    )
    const dbInvoices = rows.rows.map((r: Record<string, unknown>) => [
      Number(r.id),
      Number(r.buyer_id),
      Number(r.total_cost),
      Number(r.orders_total),
      r.is_paid === true,
      r.paid_at !== null,
    ])
    const modelInvoices = invoices.map((i) => [i.id, i.buyer, i.total, i.total, i.paid, i.paid])
    if (JSON.stringify(dbInvoices) !== JSON.stringify(modelInvoices)) {
      throw new Error(
        `invoices ≠ model\n db    ${JSON.stringify(dbInvoices)}\n model ${JSON.stringify(modelInvoices)}`
      )
    }

    // The billing preview, buyer by buyer (heaviest first, like the page lists it).
    const preview = await invoiceService.getUninvoicedSummary(supplier.id)
    const perBuyer = new Map<number, { count: number; total: number }>()
    for (const order of orders.filter((o) => o.invoice === null)) {
      const row = perBuyer.get(order.buyer) ?? { count: 0, total: 0 }
      perBuyer.set(order.buyer, { count: row.count + 1, total: row.total + order.price })
    }
    const previewRows = preview
      .map((r) => [Number(r.buyerId), r.orderCount, r.totalCost])
      .sort((a, b) => a[0] - b[0])
    const modelRows = [...perBuyer]
      .map(([buyer, row]) => [buyer, row.count, row.total])
      .sort((a, b) => a[0] - b[0])
    if (JSON.stringify(previewRows) !== JSON.stringify(modelRows)) {
      throw new Error(
        `uninvoiced preview ≠ model ${JSON.stringify(previewRows)} vs ${JSON.stringify(modelRows)}`
      )
    }
    for (let i = 1; i < preview.length; i++) {
      if (preview[i - 1].totalCost < preview[i].totalCost) throw new Error('preview not by total')
    }
    const previewOthers = preview
      .filter((r) => Number(r.buyerId) !== supplier.id)
      .reduce((s, r) => s + r.totalCost, 0)
    if (previewOthers !== owed.uninvoiced) throw new Error('preview total ≠ finance uninvoiced')

    // The colleague's lot never leaks in, and the supplier's buying from it is not income.
    const theirs = await finance.getSummary(colleague.id, finance.currentYear(), 0)
    if (theirs.revenue !== colleagueSales.reduce((total, p) => total + p, 0)) {
      throw new Error(`colleague revenue ${theirs.revenue} ≠ ${colleagueSales}`)
    }
    // Their buying from my lot is my sale; only buying from their own lot is theirs to eat.
    if (theirs.ownConsumption.units !== colleagueOwn) {
      throw new Error(`colleague own consumption ${theirs.ownConsumption.units} ≠ ${colleagueOwn}`)
    }

    const violations = await collectStockViolations({ skipOverview: true })
    if (violations.length > 0) throw new Error(violations.join('\n'))
  }
}

test.group('Money of a supplier — model-based lifecycle', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })
  group.each.teardown(cleanAll)

  test('purchases, invoices, payments, storno and corrections keep the money in balance', async ({
    assert,
  }) => {
    executed.clear()
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 5, maxLength: 16 }), runScenario),
      { seed: 20261004, numRuns: 50, endOnFailure: true }
    )
    // The generator must really reach every branch, or the property proves little.
    for (const kind of [
      'buy',
      'buyColleague',
      'invoiceAll',
      'invoiceOne',
      'request',
      'approve',
      'reject',
      'storno',
      'stornoRefused',
      'reprice',
    ]) {
      assert.isAbove(
        executed.get(kind) ?? 0,
        3,
        `too few ${kind}: ${JSON.stringify([...executed])}`
      )
    }
  }).timeout(120_000)
})

test.group('Money of a supplier — records from before paid_at', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  // Mutation caught: dropping `buyer_id <> supplier_id` from the unpaid sum. A self-invoice is
  // issued as paid now, but older ones were not always — the supplier owes nothing to themself.
  test('an unpaid self-invoice is neither a debt nor income', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    await db.table('invoices').multiInsert(
      [
        { buyer_id: supplier.id, total_cost: 70, is_paid: false },
        { buyer_id: supplier.id, total_cost: 15, is_paid: true },
        { buyer_id: buyer.id, total_cost: 30, is_paid: false },
      ].map((row) => ({
        ...row,
        supplier_id: supplier.id,
        is_payment_requested: false,
        paid_at: row.is_paid ? new Date() : null,
        auto_reminder_count: 0,
        manual_reminder_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
      }))
    )
    assert.deepEqual(await finance.owedNow(supplier.id), { uninvoiced: 0, unpaid: 30 })
    assert.equal(await finance.receivedIn(supplier.id), 0)
  })
})

test.group('Money of a supplier — concurrent clicks', (group) => {
  let fake: ReturnType<typeof mail.fake>
  group.each.setup(async () => {
    await cleanAll()
    fake = mail.fake()
    return () => mail.restore()
  })
  group.each.teardown(cleanAll)

  // Mutation caught: dropping forUpdate / the `invoice_id IS NULL` recheck in generateInvoices.
  test('two billing runs at once invoice every order exactly once', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyers = [await UserFactory.create(), await UserFactory.create()]
    const category = await CategoryFactory.create()
    const cola = await ProductFactory.merge({ categoryId: category.id }).create()
    const lot = await Delivery.create({
      supplierId: supplier.id,
      productId: cola.id,
      amountSupplied: 10,
      amountLeft: 10,
      amountLost: 0,
      price: 20,
      purchasePrice: null,
    })
    for (const buyer of [...buyers, ...buyers, supplier]) {
      await orderService.purchase(buyer.id, lot.id, 'web')
    }

    const results = await Promise.allSettled([
      invoiceService.generateInvoices(supplier.id),
      invoiceService.generateInvoices(supplier.id),
      invoiceService.generateInvoiceForBuyer(supplier.id, buyers[0].id),
    ])
    assert.deepEqual(
      results.map((r) => r.status),
      ['fulfilled', 'fulfilled', 'fulfilled']
    )
    // Two buyers × 2 × 20 and the supplier's own 20: three invoices, 100 in all, no order twice.
    const invoices = await db.from('invoices').orderBy('buyer_id')
    assert.deepEqual(
      invoices.map((i) => [i.buyer_id, i.total_cost]).sort((a, b) => a[0] - b[0]),
      [
        [buyers[0].id, 40],
        [buyers[1].id, 40],
        [supplier.id, 20],
      ].sort((a, b) => a[0] - b[0])
    )
    const uninvoiced = await db.from('orders').whereNull('invoice_id').count('* as n').first()
    assert.equal(Number(uninvoiced.n), 0)
    assert.deepInclude(await finance.owedNow(supplier.id), { uninvoiced: 0, unpaid: 80 })
  })

  // Regression: an approval that does not read and write the invoice atomically — a double
  // click e-mailed the buyer twice and logged two approvals of one payment.
  test('approving one payment twice at once records and announces it once', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.merge({ email: 'dvojklik@example.com' }).create()
    const category = await CategoryFactory.create()
    const cola = await ProductFactory.merge({ categoryId: category.id }).create()
    const lot = await Delivery.create({
      supplierId: supplier.id,
      productId: cola.id,
      amountSupplied: 2,
      amountLeft: 2,
      amountLost: 0,
      price: 20,
      purchasePrice: null,
    })
    await orderService.purchase(buyer.id, lot.id, 'web')
    const [invoice] = await invoiceService.generateInvoices(supplier.id)
    await invoiceService.requestPayment(invoice.id, buyer.id)

    await Promise.allSettled([
      invoiceService.approvePayment(invoice.id, supplier.id),
      invoiceService.approvePayment(invoice.id, supplier.id),
    ])

    const approvals = await db
      .from('audit_logs')
      .where('action', 'payment.approved')
      .where('entity_id', invoice.id)
    assert.lengthOf(approvals, 1, 'one payment, one approval in the audit log')
    assert.deepInclude(approvals[0].metadata, { isPaid: { from: false, to: true } })
    assert.equal(await finance.receivedIn(supplier.id), 20)

    // The buyer hears about the invoice and the approval — once each. E-mails go out after
    // the commit, so wait for the second one and give a duplicate the chance to show up.
    const toBuyer = () =>
      fake.messages.sent().filter((message) => message.hasTo('dvojklik@example.com')).length
    const started = Date.now()
    while (toBuyer() < 2 && Date.now() - started < 3000) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(toBuyer(), 2)
  })
})
