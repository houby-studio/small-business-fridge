import '#tests/test_context'
import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import { store as throttleStore } from '#middleware/throttle_middleware'
import db from '@adonisjs/lucid/services/db'

test.group('API Auth - Token', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await db.from('auth_access_tokens').delete()
    await db.from('users').delete()
  })

  test('can get token with valid email/password', async ({ client, assert }) => {
    await UserFactory.merge({ email: 'apiuser@example.com', password: 'password123' }).create()

    const response = await client.post('/api/v1/auth/token').json({
      email: 'apiuser@example.com',
      password: 'password123',
    })

    response.assertStatus(200)
    assert.exists(response.body().token)
    assert.exists(response.body().user)
  })

  test('returns 401 with wrong password', async ({ client }) => {
    await UserFactory.merge({ email: 'apiuser2@example.com', password: 'password123' }).create()

    const response = await client.post('/api/v1/auth/token').json({
      email: 'apiuser2@example.com',
      password: 'wrongpassword',
    })

    response.assertStatus(401)
  })

  test('returns 401 for disabled user', async ({ client }) => {
    await UserFactory.merge({ email: 'disabled3@example.com', password: 'password123' })
      .apply('disabled')
      .create()

    const response = await client.post('/api/v1/auth/token').json({
      email: 'disabled3@example.com',
      password: 'password123',
    })

    response.assertStatus(401)
  })
})

test.group('API Auth - Keypad Login', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await db.from('auth_access_tokens').delete()
    await db.from('users').delete()
  })

  test('can login with keypadId and API secret', async ({ client, assert }) => {
    await UserFactory.merge({ keypadId: 42 }).create()

    const response = await client.post('/api/v1/auth/login').json({
      keypadId: 42,
      apiSecret: 'test-api-secret',
    })

    response.assertStatus(200)
    assert.exists(response.body().token)
    assert.equal(response.body().user.keypadId, 42)
  })

  test('returns 401 with wrong API secret', async ({ client }) => {
    await UserFactory.merge({ keypadId: 43 }).create()

    const response = await client.post('/api/v1/auth/login').json({
      keypadId: 43,
      apiSecret: 'wrong-secret',
    })

    response.assertStatus(401)
  })

  test('returns 401 for non-existent keypadId', async ({ client }) => {
    const response = await client.post('/api/v1/auth/login').json({
      keypadId: 99999,
      apiSecret: 'test-api-secret',
    })

    response.assertStatus(401)
  })
})
