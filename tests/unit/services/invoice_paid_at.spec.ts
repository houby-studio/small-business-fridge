import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { InvoiceFactory } from '#database/factories/invoice_factory'
import { OrderFactory } from '#database/factories/order_factory'
import InvoiceService from '#services/invoice_service'
import Invoice from '#models/invoice'
import { BACKFILL_PAID_AT_SQL } from '#database/migrations/1786100000311_add_paid_at_to_invoices'

const invoiceService = new InvoiceService()

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('orders').delete()
  await db.from('invoices').delete()
  await db.from('deliveries').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('users').delete()
}

async function soldLot() {
  const supplier = await UserFactory.apply('supplier').create()
  const buyer = await UserFactory.create()
  const delivery = await DeliveryFactory.with('product', 1, (p) => p.with('category'))
    .merge({ supplierId: supplier.id, amountSupplied: 5, amountLeft: 3, price: 20 })
    .create()
  await OrderFactory.merge({ buyerId: buyer.id, deliveryId: delivery.id, unitPrice: 20 }).create()
  await OrderFactory.merge({
    buyerId: supplier.id,
    deliveryId: delivery.id,
    unitPrice: 20,
  }).create()
  return { supplier, buyer }
}

test.group('InvoiceService - paid_at', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('an invoice is unpaid until approved; a self-invoice is paid when issued', async ({
    assert,
  }) => {
    const { supplier, buyer } = await soldLot()
    const before = DateTime.now().minus({ seconds: 1 })

    const invoices = await invoiceService.generateInvoices(supplier.id)
    const toBuyer = invoices.find((i) => i.buyerId === buyer.id)!
    const self = invoices.find((i) => i.buyerId === supplier.id)!
    assert.isNull(toBuyer.paidAt)
    assert.isTrue(self.isPaid)
    assert.isTrue(self.paidAt! >= before)

    await invoiceService.approvePayment(toBuyer.id, supplier.id)
    const approved = await Invoice.findOrFail(toBuyer.id)
    assert.isTrue(approved.paidAt! >= before)
  })

  test('approving again keeps the first payment date; rejecting clears it', async ({ assert }) => {
    const { supplier, buyer } = await soldLot()
    const invoice = (await invoiceService.generateInvoiceForBuyer(supplier.id, buyer.id))!
    await invoiceService.approvePayment(invoice.id, supplier.id)
    const firstPaidAt = DateTime.fromISO('2026-01-05T10:00:00Z')
    await db.from('invoices').where('id', invoice.id).update({ paid_at: firstPaidAt.toJSDate() })

    await invoiceService.approvePayment(invoice.id, supplier.id)
    const still = await Invoice.findOrFail(invoice.id)
    assert.equal(still.paidAt!.toMillis(), firstPaidAt.toMillis())

    await invoiceService.rejectPayment(invoice.id, supplier.id)
    const rejected = await Invoice.findOrFail(invoice.id)
    assert.isFalse(rejected.isPaid)
    assert.isNull(rejected.paidAt)
  })

  test('the migration backfill takes the approval from the audit log, else the last update', async ({
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()
    const created = DateTime.fromISO('2025-12-20T09:00:00Z')
    const approvedAt = DateTime.fromISO('2026-01-03T12:00:00Z')
    const updatedAt = DateTime.fromISO('2026-02-01T08:00:00Z')

    const audited = await InvoiceFactory.merge({ supplierId: supplier.id, buyerId: buyer.id })
      .apply('paid')
      .create()
    const unaudited = await InvoiceFactory.merge({ supplierId: supplier.id, buyerId: buyer.id })
      .apply('paid')
      .create()
    const self = await InvoiceFactory.merge({ supplierId: supplier.id, buyerId: supplier.id })
      .apply('paid')
      .create()
    const unpaid = await InvoiceFactory.merge({
      supplierId: supplier.id,
      buyerId: buyer.id,
    }).create()
    await db.from('invoices').whereIn('id', [audited.id, unaudited.id, self.id, unpaid.id]).update({
      paid_at: null,
      created_at: created.toJSDate(),
      updated_at: updatedAt.toJSDate(),
    })
    await db.table('audit_logs').insert([
      {
        user_id: supplier.id,
        action: 'payment.approved',
        entity_type: 'invoice',
        entity_id: audited.id,
        created_at: approvedAt.minus({ days: 1 }).toJSDate(),
      },
      {
        user_id: supplier.id,
        action: 'payment.approved',
        entity_type: 'invoice',
        entity_id: audited.id,
        created_at: approvedAt.toJSDate(),
      },
    ])

    await db.rawQuery(BACKFILL_PAID_AT_SQL)

    const paidAt = async (id: number) => {
      const row = await db.from('invoices').where('id', id).select('paid_at').firstOrFail()
      return row.paid_at === null ? null : new Date(row.paid_at).getTime()
    }
    assert.equal(await paidAt(audited.id), approvedAt.toMillis())
    assert.equal(await paidAt(unaudited.id), updatedAt.toMillis())
    assert.equal(await paidAt(self.id), created.toMillis())
    assert.isNull(await paidAt(unpaid.id))
  })
})
