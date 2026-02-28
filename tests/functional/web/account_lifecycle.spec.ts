import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import PasswordResetService from '#services/password_reset_service'
import { UserFactory } from '#database/factories/user_factory'
import { store as throttleStore } from '#middleware/throttle_middleware'

test.group('Web Auth - Registration and Password Lifecycle', (group) => {
  const previousMode = process.env.REGISTRATION_MODE

  group.setup(() => {
    process.env.REGISTRATION_MODE = 'open'
  })

  group.teardown(() => {
    if (previousMode === undefined) {
      delete process.env.REGISTRATION_MODE
      return
    }
    process.env.REGISTRATION_MODE = previousMode
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
        username: 'new-open-user',
        password: 'supersecret123',
        passwordConfirmation: 'supersecret123',
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/shop')

    const created = await User.findBy('username', 'new-open-user')
    assert.exists(created)
    assert.equal(created!.email, 'new-open-user@example.com')
  })

  test('register rejects invalid email/username/password payload', async ({ client, assert }) => {
    await UserFactory.apply('admin').create()

    const response = await client
      .post('/register')
      .form({
        displayName: 'Invalid User',
        email: 'not-an-email',
        username: 'x',
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
    await UserFactory.merge({ email: 'reset-me@example.com', username: 'resetme' }).create()

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
        username: 'resetme',
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
    const user = await UserFactory.merge({ username: 'profile-pass-user' }).create()

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
        username: 'profile-pass-user',
        password: 'changed-pass-123',
      })
      .withCsrfToken()
      .redirects(0)

    loginResponse.assertStatus(302)
    loginResponse.assertHeader('location', '/shop')
  })

  test('profile password change rejects mismatched confirmation', async ({ client, assert }) => {
    await UserFactory.apply('admin').create()
    const user = await UserFactory.merge({ username: 'mismatch-pass-user' }).create()

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
        username: 'mismatch-pass-user',
        password: 'password123',
      })
      .withCsrfToken()
      .redirects(0)

    loginOldPassword.assertStatus(302)
    loginOldPassword.assertHeader('location', '/shop')

    const loginNewPassword = await client
      .post('/login')
      .form({
        username: 'mismatch-pass-user',
        password: 'changed-pass-123',
      })
      .withCsrfToken()
      .redirects(0)

    loginNewPassword.assertStatus(302)
    assert.notEqual(loginNewPassword.header('location'), '/shop')
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
