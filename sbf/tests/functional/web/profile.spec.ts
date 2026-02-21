import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('user_favorites').delete()
  await db.from('auth_access_tokens').delete()
  await db.from('users').delete()
}

test.group('Web Profile - color mode toggle', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('POST /profile/color-mode saves dark mode and redirects', async ({ client, assert }) => {
    const user = await UserFactory.merge({ colorMode: 'light' }).create()

    const response = await client
      .post('/profile/color-mode')
      .json({ colorMode: 'dark' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const updated = await User.findOrFail(user.id)
    assert.equal(updated.colorMode, 'dark')
  })

  test('POST /profile/color-mode saves light mode and redirects', async ({ client, assert }) => {
    const user = await UserFactory.merge({ colorMode: 'dark' }).create()

    const response = await client
      .post('/profile/color-mode')
      .json({ colorMode: 'light' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const updated = await User.findOrFail(user.id)
    assert.equal(updated.colorMode, 'light')
  })

  test('POST /profile/color-mode rejects invalid value and does not update', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.merge({ colorMode: 'light' }).create()

    const response = await client
      .post('/profile/color-mode')
      .json({ colorMode: 'auto' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    // Inertia validation failure redirects back
    response.assertStatus(302)

    // colorMode should not have changed
    const updated = await User.findOrFail(user.id)
    assert.equal(updated.colorMode, 'light')
  })

  test('POST /profile/color-mode requires authentication', async ({ client }) => {
    const response = await client
      .post('/profile/color-mode')
      .json({ colorMode: 'dark' })
      .redirects(0)

    response.assertStatus(302)
  })
})

test.group('Web Profile - API tokens', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('POST /profile/tokens creates a token and redirects', async ({ client, assert }) => {
    const user = await UserFactory.create()

    const response = await client
      .post('/profile/tokens')
      .json({ name: 'My home automation' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const tokens = await db
      .from('auth_access_tokens')
      .where('tokenable_id', user.id)
      .where('name', 'My home automation')

    assert.lengthOf(tokens, 1)
  })

  test('POST /profile/tokens with expiry stores expires_at', async ({ client, assert }) => {
    const user = await UserFactory.create()

    const response = await client
      .post('/profile/tokens')
      .json({ name: 'Expiring token', expiresInDays: 30 })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const token = await db
      .from('auth_access_tokens')
      .where('tokenable_id', user.id)
      .where('name', 'Expiring token')
      .first()

    assert.isNotNull(token)
    assert.isNotNull(token.expires_at)
  })

  test('DELETE /profile/tokens/:id revokes own token', async ({ client, assert }) => {
    const user = await UserFactory.create()

    // Create a token first
    const token = await User.accessTokens.create(user, ['*'], { name: 'to-revoke' })

    const response = await client
      .delete(`/profile/tokens/${token.identifier}`)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const remaining = await db.from('auth_access_tokens').where('id', token.identifier)

    assert.lengthOf(remaining, 0)
  })

  test('DELETE /profile/tokens/:id cannot revoke another user token', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()
    const other = await UserFactory.create()

    const otherToken = await User.accessTokens.create(other, ['*'], { name: 'other-token' })

    const response = await client
      .delete(`/profile/tokens/${otherToken.identifier}`)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    // Redirects with not_found error
    response.assertStatus(302)

    // Token still exists
    const remaining = await db.from('auth_access_tokens').where('id', otherToken.identifier)
    assert.lengthOf(remaining, 1)
  })

  test('GET /profile renders profile page with token list', async ({ client }) => {
    const user = await UserFactory.create()
    await User.accessTokens.create(user, ['*'], { name: 'my-personal-token' })

    const response = await client.get('/profile').loginAs(user)
    response.assertStatus(200)
  })
})
