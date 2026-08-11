import '#tests/test_context'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { store as throttleStore } from '#middleware/throttle_middleware'
import { UserFactory } from '#database/factories/user_factory'
import db from '@adonisjs/lucid/services/db'

const throttleKeys = () => [...throttleStore.keys()].filter((key) => key.startsWith('throttle:ip:'))

/**
 * Fill this environment's own bucket, discovering its key with one throwaway request.
 *
 * The peer address is not portable — loopback surfaces as `127.0.0.1` on some runners and
 * `::ffff:127.0.0.1` on others — so a hard-coded key fills a bucket nothing ever reads and
 * the request under test silently is not throttled at all.
 */
async function exhaustOwnBucket(client: ApiClient) {
  throttleStore.clear()
  await client.get('/api/v1/health')

  const keys = throttleKeys()
  if (keys.length !== 1) {
    throw new Error(`expected exactly one throttle bucket, saw: ${keys.join(', ') || '(none)'}`)
  }

  throttleStore.set(keys[0], { count: 10_000, resetAt: Date.now() + 30_000 })
  return keys[0]
}

test.group('Rate Limit Middleware', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await db.from('remember_me_tokens').delete()
    await db.from('users').delete()
  })

  test('Inertia web requests are redirected back with flash when throttled', async ({ client }) => {
    await UserFactory.apply('admin').create()
    await exhaustOwnBucket(client)

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
    await exhaustOwnBucket(client)

    const response = await client.get('/api/v1/health')

    response.assertStatus(429)
    assert.exists(response.header('retry-after'))
    assert.equal(response.body().error, 'Too many requests')
    assert.isNumber(response.body().retryAfter)
  })

  test('the counter really increments per request', async ({ client, assert }) => {
    await client.get('/api/v1/health')
    const keys = throttleKeys()
    assert.lengthOf(keys, 1)
    const countAfterFirst = throttleStore.get(keys[0])!.count

    await client.get('/api/v1/health')
    const countAfterSecond = throttleStore.get(keys[0])!.count

    assert.equal(countAfterSecond, countAfterFirst + 1)
  })

  /**
   * Buckets follow request.ip(), which resolves X-Forwarded-For only through the configured
   * trustProxy tier — the middleware no longer reads the header itself. Verified by running
   * this suite with TRUST_PROXY=false, where every forwarded address collapses into the
   * single peer bucket instead of minting one per header value.
   */
  test('a trusted proxy chain still separates real clients', async ({ client, assert }) => {
    // trustProxy defaults to "loopback", and tests arrive from loopback, so a well-formed
    // forwarded address is honoured — which is what keeps per-client limits meaningful
    // behind the reverse proxy in production.
    await client.get('/api/v1/health').header('X-Forwarded-For', '203.0.113.1')
    await client.get('/api/v1/health').header('X-Forwarded-For', '203.0.113.2')

    assert.includeMembers(throttleKeys(), ['throttle:ip:203.0.113.1', 'throttle:ip:203.0.113.2'])
    assert.equal(throttleStore.get('throttle:ip:203.0.113.1')!.count, 1)
  })
})
