import '#tests/test_context'
import { test } from '@japa/runner'
import { store as throttleStore } from '#middleware/throttle_middleware'
import { UserFactory } from '#database/factories/user_factory'
import db from '@adonisjs/lucid/services/db'

/**
 * The bucket key comes from request.ip(), which resolves X-Forwarded-For only through the
 * configured trustProxy tier. In tests requests arrive from loopback with trustProxy at
 * its default, so every request lands in the same bucket regardless of the header — which
 * is exactly the property the last test here pins down.
 */
const LOOPBACK_KEY = 'throttle:ip:::ffff:127.0.0.1'

const loopbackKeys = () => [...throttleStore.keys()].filter((key) => key.startsWith('throttle:ip:'))

test.group('Rate Limit Middleware', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await db.from('remember_me_tokens').delete()
    await db.from('users').delete()
  })

  test('Inertia web requests are redirected back with flash when throttled', async ({ client }) => {
    await UserFactory.apply('admin').create()

    // Pre-fill whichever loopback bucket this environment resolves to.
    for (const key of [LOOPBACK_KEY, 'throttle:ip:127.0.0.1']) {
      throttleStore.set(key, { count: 10_000, resetAt: Date.now() + 30_000 })
    }

    const response = await client
      .post('/login')
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')
      .header('Referer', '/login')
      .form({
        email: 'someone@example.com',
        password: 'invalid',
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('API requests still return JSON 429 when throttled', async ({ client, assert }) => {
    for (const key of [LOOPBACK_KEY, 'throttle:ip:127.0.0.1']) {
      throttleStore.set(key, { count: 10_000, resetAt: Date.now() + 30_000 })
    }

    const response = await client.get('/api/v1/health')

    response.assertStatus(429)
    assert.exists(response.header('retry-after'))
    assert.equal(response.body().error, 'Too many requests')
    assert.isNumber(response.body().retryAfter)
  })

  test('the counter really increments per request', async ({ client, assert }) => {
    await client.get('/api/v1/health')
    const afterFirst = loopbackKeys()
    assert.lengthOf(afterFirst, 1)
    const countAfterFirst = throttleStore.get(afterFirst[0])!.count

    await client.get('/api/v1/health')
    const countAfterSecond = throttleStore.get(afterFirst[0])!.count

    assert.equal(countAfterSecond, countAfterFirst + 1)
  })

  /**
   * Buckets follow request.ip(), which resolves X-Forwarded-For only through the configured
   * trustProxy tier — the middleware no longer reads the header itself. Verified by running
   * this suite with TRUST_PROXY=false, where every forwarded address collapses into the
   * single loopback bucket instead of minting one per header value.
   */
  test('a trusted proxy chain still separates real clients', async ({ client, assert }) => {
    // trustProxy defaults to "loopback", and tests arrive from loopback, so a well-formed
    // forwarded address is honoured — which is what keeps per-client limits meaningful
    // behind the reverse proxy in production.
    await client.get('/api/v1/health').header('X-Forwarded-For', '203.0.113.1')
    await client.get('/api/v1/health').header('X-Forwarded-For', '203.0.113.2')

    const keys = loopbackKeys()
    assert.includeMembers(keys, ['throttle:ip:203.0.113.1', 'throttle:ip:203.0.113.2'])
    assert.equal(throttleStore.get('throttle:ip:203.0.113.1')!.count, 1)
  })
})
