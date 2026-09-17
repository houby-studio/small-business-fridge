import '#tests/test_context'
import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import db from '@adonisjs/lucid/services/db'
import buildInfo from '#services/build_info'

test.group('Build info', (group) => {
  group.each.setup(async () => {
    await db.from('users').delete()
  })

  test('build info is shared with every Inertia page', async ({ client, assert }) => {
    const user = await UserFactory.create()

    const response = await client
      .get('/shop')
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')
      .loginAs(user)
    response.assertStatus(200)

    const props = response.body().props
    assert.exists(props.build, 'build info missing from shared props')
    assert.equal(props.build.version, buildInfo.version)
    assert.properties(props.build, ['version', 'commit', 'commitShort', 'buildDate'])
  })

  test('falls back to dev when the image carries no build metadata', ({ assert }) => {
    // Nothing sets APP_VERSION in the test environment, so this is the real local shape.
    assert.equal(buildInfo.version, 'dev')
    assert.isNull(buildInfo.commit)
    assert.isNull(buildInfo.commitShort)
  })

  test('build info stays off the unauthenticated health endpoint', async ({ client, assert }) => {
    const response = await client.get('/api/v1/health')
    response.assertStatus(200)

    // `/api/v1/health` is reachable without a session and, in a typical deployment, from
    // the internet. Advertising the exact build there hands an attacker a version to look
    // up. Operators read it from the image label instead.
    const body = response.body()
    assert.notProperty(body, 'version')
    assert.notProperty(body, 'commit')
    assert.notProperty(body, 'build')
  })
})
