import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import db from '@adonisjs/lucid/services/db'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('users').delete()
}

test.group('Admin Impersonation', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('admin can start impersonating a customer', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const customer = await UserFactory.create()

    const response = await client
      .post(`/admin/users/${customer.id}/impersonate`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    // Redirected to /shop after starting impersonation
    response.assertStatus(302)
    response.assertHeader('location', '/shop')
  })

  test('admin can stop impersonation', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const customer = await UserFactory.create()

    // Inject __impersonation directly into session to simulate active impersonation
    const response = await client
      .post('/impersonate/stop')
      .loginAs(admin)
      .withSession({
        __impersonation: {
          byId: admin.id,
          asId: customer.id,
          asName: customer.displayName,
        },
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/admin/users')
  })

  test('non-admin cannot impersonate', async ({ client }) => {
    const customer = await UserFactory.create()
    const target = await UserFactory.create()

    const response = await client
      .post(`/admin/users/${target.id}/impersonate`)
      .loginAs(customer)
      .withCsrfToken()
      .redirects(0)

    // Role middleware redirects to /
    response.assertStatus(302)
    response.assertHeader('location', '/')
  })

  test('admin cannot impersonate another admin', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const admin2 = await UserFactory.apply('admin').create()

    const response = await client
      .post(`/admin/users/${admin2.id}/impersonate`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    // Redirects back to /admin/users with error
    response.assertStatus(302)
    response.assertHeader('location', '/admin/users')
  })

  test('admin cannot impersonate themselves', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()

    const response = await client
      .post(`/admin/users/${admin.id}/impersonate`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/admin/users')
  })

  test('admin cannot impersonate a kiosk account', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const kiosk = await UserFactory.apply('kiosk').create()

    const response = await client
      .post(`/admin/users/${kiosk.id}/impersonate`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/admin/users')
  })

  test('impersonation start is recorded in audit log', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const customer = await UserFactory.create()

    await client
      .post(`/admin/users/${customer.id}/impersonate`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    const log = await db
      .from('audit_logs')
      .where('action', 'admin.impersonate.start')
      .where('user_id', admin.id)
      .first()

    assert.isNotNull(log)
    assert.equal(log.target_user_id, customer.id)
  })
})
