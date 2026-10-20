import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { InvoiceFactory } from '#database/factories/invoice_factory'
import AnonymizationService from '#services/anonymization_service'

const service = new AnonymizationService()
const IBAN = 'CZ6508000000192000145399'

async function leftSupplierOwed() {
  const supplier = await UserFactory.apply('supplier')
    .merge({ isDisabled: true, iban: IBAN, disabledAt: DateTime.utc().minus({ days: 10 }) })
    .create()
  const buyer = await UserFactory.create()
  const invoice = await InvoiceFactory.merge({
    supplierId: supplier.id,
    buyerId: buyer.id,
  }).create()
  return { supplier, invoice }
}

test.group('AnonymizationService - IBAN of a supplier still owed money', (group) => {
  group.each.setup(async () => {
    await db.rawQuery('TRUNCATE TABLE audit_logs, invoices, users RESTART IDENTITY CASCADE')
  })

  test('keeps the IBAN while buyers still have to pay their invoices', async ({ assert }) => {
    const { supplier } = await leftSupplierOwed()

    assert.isTrue(await service.anonymizeUser(supplier.id))
    await supplier.refresh()
    assert.isNotNull(supplier.anonymizedAt)
    assert.match(supplier.email, /@anon$/)
    assert.equal(supplier.iban, IBAN)
    const audit = await db.from('audit_logs').where('action', 'user.anonymized').firstOrFail()
    assert.isTrue(audit.metadata.ibanKeptForUnpaidInvoices)
  })

  test('the sweep clears the kept IBAN once every invoice is paid', async ({ assert }) => {
    const { supplier, invoice } = await leftSupplierOwed()
    await service.anonymizeDisabledUsers(7)
    await supplier.refresh()
    assert.equal(supplier.iban, IBAN)

    const stillOwed = await service.anonymizeDisabledUsers(7)
    assert.equal(stillOwed.ibansCleared, 0)

    await db.from('invoices').where('id', invoice.id).update({ is_paid: true })
    const settled = await service.anonymizeDisabledUsers(7)
    assert.equal(settled.ibansCleared, 1)
    await supplier.refresh()
    assert.isNull(supplier.iban)
  })

  test('a supplier nobody owes loses the IBAN right away', async ({ assert }) => {
    const { supplier, invoice } = await leftSupplierOwed()
    await db.from('invoices').where('id', invoice.id).update({ is_paid: true })

    await service.anonymizeUser(supplier.id)
    await supplier.refresh()
    assert.isNull(supplier.iban)
  })
})
