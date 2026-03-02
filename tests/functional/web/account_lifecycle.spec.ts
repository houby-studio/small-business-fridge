import '#tests/test_context'
import { test } from '@japa/runner'
import hash from '@adonisjs/core/services/hash'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import PasswordResetService from '#services/password_reset_service'
import { UserFactory } from '#database/factories/user_factory'
import { store as throttleStore } from '#middleware/throttle_middleware'

test.group('Web Auth - Registration and Password Lifecycle', (group) => {
  const previousMode = process.env.AUTH_REGISTRATION_MODE
  const previousProviders = process.env.AUTH_PROVIDERS

  group.setup(() => {
    process.env.AUTH_REGISTRATION_MODE = 'open'
  })

  group.teardown(() => {
    if (previousMode === undefined) {
      delete process.env.AUTH_REGISTRATION_MODE
    } else {
      process.env.AUTH_REGISTRATION_MODE = previousMode
    }

    if (previousProviders === undefined) {
      delete process.env.AUTH_PROVIDERS
    } else {
      process.env.AUTH_PROVIDERS = previousProviders
    }
  })

  group.each.setup(async () => {
    throttleStore.clear()
    await db.from('remember_me_tokens').delete()
    await db.from('password_reset_tokens').delete()
    await db.from('user_invitations').delete()
    await db.from('orders').delete()
    await db.from('deliveries').delete()
    await db.from('products').delete()
    await db.from('categories').delete()
    await db.from('users').delete()
  })

  test('guest can register local account in open mode', async ({ client, assert }) => {
    await UserFactory.apply('admin').create()

    const response = await client
      .post('/register')
      .form({
        displayName: 'New Open User',
        email: 'new-open-user@example.com',
        password: 'supersecret123',
        passwordConfirmation: 'supersecret123',
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/shop')

    const created = await User.findBy('email', 'new-open-user@example.com')
    assert.exists(created)
    assert.equal(created!.email, 'new-open-user@example.com')
  })

  test('register rejects invalid email/password payload', async ({ client, assert }) => {
    await UserFactory.apply('admin').create()

    const response = await client
      .post('/register')
      .form({
        displayName: 'Invalid User',
        email: 'not-an-email',
        password: 'short',
        passwordConfirmation: 'short',
      })
      .withCsrfToken()
      .redirects(0)

    assert.include([302, 422], response.status())

    const created = await User.findBy('displayName', 'Invalid User')
    assert.isNull(created)
  })

  test('forgot password creates reset token and reset updates password', async ({
    client,
    assert,
  }) => {
    await UserFactory.apply('admin').create()
    await UserFactory.merge({ email: 'reset-me@example.com' }).create()

    const forgotResponse = await client
      .post('/forgot-password')
      .form({ email: 'reset-me@example.com' })
      .withCsrfToken()
      .redirects(0)

    forgotResponse.assertStatus(302)
    forgotResponse.assertHeader('location', '/forgot-password')

    const tokenRow = await db
      .from('password_reset_tokens')
      .where('email', 'reset-me@example.com')
      .first()
    assert.exists(tokenRow)

    const resetService = new PasswordResetService()
    const payload = await resetService.createToken('reset-me@example.com')
    assert.exists(payload)

    const token = payload!.resetUrl.split('/').pop()!
    const resetResponse = await client
      .post(`/reset-password/${token}`)
      .form({
        password: 'new-password-123',
        passwordConfirmation: 'new-password-123',
      })
      .withCsrfToken()
      .redirects(0)

    resetResponse.assertStatus(302)
    resetResponse.assertHeader('location', '/login')

    const loginResponse = await client
      .post('/login')
      .form({
        email: 'reset-me@example.com',
        password: 'new-password-123',
      })
      .withCsrfToken()
      .redirects(0)

    loginResponse.assertStatus(302)
    loginResponse.assertHeader('location', '/shop')
  })

  test('forgot password rejects invalid email input', async ({ client, assert }) => {
    await UserFactory.apply('admin').create()

    const response = await client
      .post('/forgot-password')
      .form({ email: 'invalid-email' })
      .withCsrfToken()
      .redirects(0)

    assert.include([302, 422], response.status())

    const tokenRow = await db.from('password_reset_tokens').where('email', 'invalid-email').first()
    assert.isNotOk(tokenRow)
  })

  test('authenticated user can change password from profile', async ({ client }) => {
    await UserFactory.apply('admin').create()
    const user = await UserFactory.merge({ email: 'profile-pass-user@example.com' }).create()

    const response = await client
      .put('/profile/password')
      .loginAs(user)
      .form({
        currentPassword: 'password123',
        newPassword: 'changed-pass-123',
        newPasswordConfirmation: 'changed-pass-123',
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/profile')

    const loginResponse = await client
      .post('/login')
      .form({
        email: 'profile-pass-user@example.com',
        password: 'changed-pass-123',
      })
      .withCsrfToken()
      .redirects(0)

    loginResponse.assertStatus(302)
    loginResponse.assertHeader('location', '/shop')
  })

  test('profile password change rejects mismatched confirmation', async ({ client, assert }) => {
    await UserFactory.apply('admin').create()
    const user = await UserFactory.merge({ email: 'mismatch-pass-user@example.com' }).create()

    const response = await client
      .put('/profile/password')
      .loginAs(user)
      .form({
        currentPassword: 'password123',
        newPassword: 'changed-pass-123',
        newPasswordConfirmation: 'different-pass-123',
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/profile')

    const loginOldPassword = await client
      .post('/login')
      .form({
        email: 'mismatch-pass-user@example.com',
        password: 'password123',
      })
      .withCsrfToken()
      .redirects(0)

    loginOldPassword.assertStatus(302)
    loginOldPassword.assertHeader('location', '/shop')

    const loginNewPassword = await client
      .post('/login')
      .form({
        email: 'mismatch-pass-user@example.com',
        password: 'changed-pass-123',
      })
      .withCsrfToken()
      .redirects(0)

    loginNewPassword.assertStatus(302)
    assert.notEqual(loginNewPassword.header('location'), '/shop')
  })

  test('authenticated user can change password using one-time sensitive grant when TTL is zero', async ({
    client,
  }) => {
    const previousTtl = process.env.SENSITIVE_ACTION_REAUTH_TTL_MINUTES
    process.env.SENSITIVE_ACTION_REAUTH_TTL_MINUTES = '0'
    await UserFactory.apply('admin').create()
    const user = await UserFactory.merge({ email: 'profile-pass-grant@example.com' }).create()

    try {
      const response = await client
        .put('/profile/password')
        .loginAs(user)
        .form({
          newPassword: 'changed-pass-456',
          newPasswordConfirmation: 'changed-pass-456',
        })
        .withSession({
          __sensitive_stepup_grant: {
            userId: user.id,
            issuedAt: new Date().toISOString(),
          },
        })
        .withCsrfToken()
        .redirects(0)

      response.assertStatus(302)
      response.assertHeader('location', '/profile')

      const loginResponse = await client
        .post('/login')
        .form({
          email: 'profile-pass-grant@example.com',
          password: 'changed-pass-456',
        })
        .withCsrfToken()
        .redirects(0)

      loginResponse.assertStatus(302)
      loginResponse.assertHeader('location', '/shop')
    } finally {
      if (previousTtl === undefined) {
        delete process.env.SENSITIVE_ACTION_REAUTH_TTL_MINUTES
      } else {
        process.env.SENSITIVE_ACTION_REAUTH_TTL_MINUTES = previousTtl
      }
    }
  })

  test('profile password change is blocked when local auth is disabled', async ({
    client,
    assert,
  }) => {
    const prevProviders = process.env.AUTH_PROVIDERS
    process.env.AUTH_PROVIDERS = 'microsoft'
    await UserFactory.apply('admin').create()
    const user = await UserFactory.merge({ email: 'profile-pass-disabled@example.com' }).create()

    try {
      const response = await client
        .put('/profile/password')
        .loginAs(user)
        .form({
          newPassword: 'changed-pass-789',
          newPasswordConfirmation: 'changed-pass-789',
        })
        .withCsrfToken()
        .redirects(0)

      response.assertStatus(302)
      response.assertHeader('location', '/profile')

      const refreshed = await User.findOrFail(user.id)
      if (!refreshed.password) {
        throw new Error('Expected persisted password hash to exist')
      }
      const persistedPasswordHash = refreshed.password
      assert.isTrue(await hash.verify(persistedPasswordHash, 'password123'))
      assert.isFalse(await hash.verify(persistedPasswordHash, 'changed-pass-789'))
    } finally {
      if (prevProviders === undefined) {
        delete process.env.AUTH_PROVIDERS
      } else {
        process.env.AUTH_PROVIDERS = prevProviders
      }
    }
  })

  test('admin can trigger password reset for another user', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const target = await UserFactory.merge({ email: 'target-reset@example.com' }).create()

    const response = await client
      .post(`/admin/users/${target.id}/send-password-reset`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/admin/users')

    const token = await db
      .from('password_reset_tokens')
      .where('email', 'target-reset@example.com')
      .first()
    assert.exists(token)
  })
})
