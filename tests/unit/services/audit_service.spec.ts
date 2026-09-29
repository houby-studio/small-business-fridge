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
