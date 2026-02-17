import { test } from '@japa/runner'
import { store as throttleStore } from '#middleware/throttle_middleware'

test.group('API Health', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
  })
  test('health endpoint returns ok status', async ({ client, assert }) => {
    const response = await client.get('/api/v1/health')
    response.assertStatus(200)

    const body = response.body()
    assert.equal(body.status, 'ok')
    assert.exists(body.timestamp)
    assert.exists(body.uptime)
    assert.exists(body.checks.database)
    assert.equal(body.checks.database.status, 'ok')
  })

  test('health endpoint includes rate limit headers', async ({ client, assert }) => {
    const response = await client.get('/api/v1/health')
    response.assertStatus(200)

    assert.exists(response.header('x-ratelimit-limit'))
    assert.exists(response.header('x-ratelimit-remaining'))
  })
})
