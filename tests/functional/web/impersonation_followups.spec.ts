import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import AuditService from '#services/audit_service'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('remember_me_tokens').delete()
  await db.from('users').delete()
}

const inertia = { 'X-Inertia': 'true', 'X-Inertia-Version': '1' }

function impersonating(admin: { id: number }, target: { id: number; displayName: string }) {
  return { __impersonation: { byId: admin.id, asId: target.id, asName: target.displayName } }
}

test.group('Impersonation lifecycle is fully audited', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('logging out while impersonating ends it and logs the admin out', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const target = await UserFactory.create()

    const response = await client
      .post('/logout')
      .loginAs(admin)
      .withSession(impersonating(admin, target))
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.notProperty(response.session(), '__impersonation')

    const stop = await db.from('audit_logs').where('action', 'admin.impersonate.stop').firstOrFail()
    assert.equal(stop.user_id, admin.id)
    assert.equal(stop.target_user_id, target.id)
    assert.equal(stop.metadata.reason, 'logout')

    // The logout is the admin's — not the impersonated user's.
    const logout = await db.from('audit_logs').where('action', 'user.logout').firstOrFail()
    assert.equal(logout.user_id, admin.id)
  })

  test('a fresh login never resumes an impersonation left in the session', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const target = await UserFactory.create()

    const response = await client
      .post('/login')
      .withSession(impersonating(admin, target))
      .withCsrfToken()
      .form({ email: admin.email, password: 'password123' })
      .redirects(0)

    response.assertStatus(302)
    assert.notProperty(response.session(), '__impersonation')
  })

  test('an impersonation whose target became invalid is closed in the audit log', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const target = await UserFactory.apply('disabled').create()

    await client.get('/shop').loginAs(admin).withSession(impersonating(admin, target)).redirects(0)

    const stop = await db.from('audit_logs').where('action', 'admin.impersonate.stop').firstOrFail()
    assert.equal(stop.metadata.reason, 'target_invalid')
    assert.equal(stop.target_user_id, target.id)
  })

  test("the impersonated user's Activity reads start and end in plain words", async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const target = await UserFactory.create()
    await AuditService.log(admin.id, 'admin.impersonate.start', 'user', target.id, target.id, {
      adminId: admin.id,
      targetName: target.displayName,
    })
    await AuditService.log(admin.id, 'admin.impersonate.stop', 'user', target.id, target.id, {
      reason: 'logout',
    })

    const response = await client.get('/audit').loginAs(target).headers(inertia)
    const rows: any[] = response.body().props.logs.data
    for (const row of rows) {
      assert.equal(row.impersonatedBy, admin.displayName)
      assert.isNull(row.metadata)
    }
    assert.sameMembers(
      rows.map((row) => `${row.impersonation.phase}:${row.impersonation.reason}`),
      ['start:null', 'stop:logout']
    )
  })

  test('filtering the admin audit by an admin includes what they did as someone else', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const target = await UserFactory.create()
    await AuditService.log(target.id, 'profile.updated', 'user', target.id, null, {
      impersonatedBy: { id: admin.id, name: admin.displayName },
    })

    const response = await client
      .get(`/admin/audit?userId=${admin.id}`)
      .loginAs(admin)
      .headers(inertia)
    const actions = (response.body().props.logs.data as any[]).map((row) => row.action)
    assert.include(actions, 'profile.updated')
  })
})
