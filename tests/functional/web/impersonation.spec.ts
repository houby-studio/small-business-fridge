import '#tests/test_context'
import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import User from '#models/user'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('auth_access_tokens').delete()
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

  test('impersonating admin cannot change target email or IBAN', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const target = await UserFactory.merge({
      email: 'target-impersonated@example.com',
      iban: 'CZ6508000000192000145399',
    }).create()

    const response = await client
      .put('/profile')
      .loginAs(admin)
      .withSession({
        __impersonation: {
          byId: admin.id,
          asId: target.id,
          asName: target.displayName,
        },
      })
      .json({
        displayName: target.displayName,
        email: 'attacker@example.com',
        currentPassword: 'password123',
        phone: target.phone,
        iban: 'CZ6508000000192000145400',
        showAllProducts: target.showAllProducts,
        sendMailOnPurchase: target.sendMailOnPurchase,
        sendDailyReport: target.sendDailyReport,
        colorMode: target.colorMode,
        keypadDisabled: target.keypadDisabled,
        excludedAllergenIds: [],
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/profile')

    await target.refresh()
    assert.equal(target.email, 'target-impersonated@example.com')
    assert.equal(target.iban, 'CZ6508000000192000145399')
  })

  test('impersonating admin cannot change target password', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const target = await UserFactory.create()
    const originalHash = target.password

    const response = await client
      .put('/profile/password')
      .loginAs(admin)
      .withSession({
        __impersonation: {
          byId: admin.id,
          asId: target.id,
          asName: target.displayName,
        },
      })
      .form({
        currentPassword: 'password123',
        newPassword: 'new-secret-123',
        newPasswordConfirmation: 'new-secret-123',
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/profile')

    // The redirect alone proves nothing — it is also what success returns. Assert the effect.
    await target.refresh()
    assert.equal(target.password, originalHash)
    assert.isFalse(await hash.verify(target.password!, 'new-secret-123'))

    const passwordAudit = await db
      .from('audit_logs')
      .where('user_id', target.id)
      .where('action', 'user.password_changed')
    assert.lengthOf(passwordAudit, 0)
  })

  test('impersonating admin cannot mint an API token for the target', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const target = await UserFactory.create()

    const response = await client
      .post('/profile/tokens')
      .loginAs(admin)
      .withSession({
        __impersonation: {
          byId: admin.id,
          asId: target.id,
          asName: target.displayName,
        },
      })
      .form({ name: 'stolen-token' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/profile')

    const tokens = await db.from('auth_access_tokens').where('tokenable_id', target.id)
    assert.lengthOf(tokens, 0)
  })

  test('impersonating admin cannot revoke the target API token', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const target = await UserFactory.create()
    const token = await User.accessTokens.create(target, ['*'], { name: 'targets-own' })

    const response = await client
      .delete(`/profile/tokens/${token.identifier}`)
      .loginAs(admin)
      .withSession({
        __impersonation: {
          byId: admin.id,
          asId: target.id,
          asName: target.displayName,
        },
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const tokens = await db.from('auth_access_tokens').where('tokenable_id', target.id)
    assert.lengthOf(tokens, 1)
  })

  test('impersonating admin cannot start OIDC link flow', async ({ client }) => {
    const previousProviders = process.env.AUTH_PROVIDERS
    process.env.AUTH_PROVIDERS = 'local,microsoft'

    try {
      const admin = await UserFactory.apply('admin').create()
      const target = await UserFactory.create()

      const response = await client
        .post('/profile/oidc-link')
        .loginAs(admin)
        .withSession({
          __impersonation: {
            byId: admin.id,
            asId: target.id,
            asName: target.displayName,
          },
        })
        .json({
          provider: 'microsoft',
          currentPassword: 'password123',
        })
        .withCsrfToken()
        .redirects(0)

      response.assertStatus(302)
      response.assertHeader('location', '/profile')
    } finally {
      if (previousProviders === undefined) {
        delete process.env.AUTH_PROVIDERS
      } else {
        process.env.AUTH_PROVIDERS = previousProviders
      }
    }
  })
})
