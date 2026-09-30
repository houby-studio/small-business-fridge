import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import AuditService from '#services/audit_service'
import { UserFactory } from '#database/factories/user_factory'

test.group('AuditService.log outside an HTTP request', (group) => {
  group.each.setup(async () => {
    await db.from('audit_logs').delete()
  })
  group.each.teardown(async () => {
    await db.from('audit_logs').delete()
    await db.from('users').delete()
  })

  test('writes the entry without an impersonation marker (scheduler, CLI)', async ({ assert }) => {
    // No request context here: HttpContext.get() is null, which must not break logging.
    const user = await UserFactory.create()
    await AuditService.log(user.id, 'user.updated', 'user', user.id, null, { field: 'x' })

    const row = await db.from('audit_logs').where('action', 'user.updated').firstOrFail()
    assert.equal(row.user_id, user.id)
    assert.deepEqual(row.metadata, { field: 'x' })
  })
})

test.group('AuditService.log inside a transaction', (group) => {
  group.each.setup(async () => {
    await db.from('audit_logs').delete()
  })
  group.each.teardown(async () => {
    await db.from('audit_logs').delete()
    await db.from('users').delete()
  })

  test('the entry commits with the transaction', async ({ assert }) => {
    const user = await UserFactory.create()
    await db.transaction(async (trx) => {
      await AuditService.log(user.id, 'user.updated', 'user', user.id, null, null, {
        client: trx,
      })
    })

    assert.exists(await db.from('audit_logs').where('action', 'user.updated').first())
  })

  test('a rolled-back transaction leaves no entry behind', async ({ assert }) => {
    const user = await UserFactory.create()
    await assert.rejects(() =>
      db.transaction(async (trx) => {
        await AuditService.log(user.id, 'order.created', 'order', 1, null, null, { client: trx })
        throw new Error('purchase failed after the log')
      })
    )

    assert.notExists(await db.from('audit_logs').where('action', 'order.created').first())
  })

  test('a failing audit insert does not abort the audited change', async ({ assert }) => {
    const user = await UserFactory.create()
    await db.transaction(async (trx) => {
      await trx.from('users').where('id', user.id).update({ display_name: 'Changed' })
      // Unknown actor → the FK on audit_logs.user_id rejects the insert.
      await AuditService.log(999_999_999, 'user.updated', 'user', user.id, null, null, {
        client: trx,
      })
      await trx.from('users').where('id', user.id).update({ phone: '123' })
    })

    const row = await db.from('users').where('id', user.id).firstOrFail()
    assert.equal(row.display_name, 'Changed')
    assert.equal(row.phone, '123')
    assert.notExists(await db.from('audit_logs').first())
  })
})
