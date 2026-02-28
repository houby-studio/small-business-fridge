import '#tests/test_context'
import { test } from '@japa/runner'
import { store as throttleStore } from '#middleware/throttle_middleware'
import { UserFactory } from '#database/factories/user_factory'
import db from '@adonisjs/lucid/services/db'

test.group('Rate Limit Middleware', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await db.from('remember_me_tokens').delete()
    await db.from('users').delete()
  })

  test('Inertia web requests are redirected back with flash when throttled', async ({ client }) => {
    await UserFactory.apply('admin').create()

    const ip = '198.51.100.11'
    throttleStore.set(`throttle:ip:${ip}`, {
      count: 10,
      resetAt: Date.now() + 30_000,
    })

    const response = await client
      .post('/login')
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')
      .header('X-Forwarded-For', ip)
      .header('Referer', '/login')
      .form({
        username: 'someone',
        password: 'invalid',
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('API requests still return JSON 429 when throttled', async ({ client, assert }) => {
    const ip = '198.51.100.12'
    throttleStore.set(`throttle:ip:${ip}`, {
      count: 60,
      resetAt: Date.now() + 30_000,
    })

    const response = await client.get('/api/v1/health').header('X-Forwarded-For', ip)

    response.assertStatus(429)
    assert.exists(response.header('retry-after'))
    assert.equal(response.body().error, 'Too many requests')
    assert.isNumber(response.body().retryAfter)
  })
})
