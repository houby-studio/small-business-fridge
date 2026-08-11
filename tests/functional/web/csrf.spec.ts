import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('auth_access_tokens').delete()
  await db.from('users').delete()
}

/**
 * Shield decides whether a request needs a CSRF token by looking at `request.method()`,
 * and only the verbs listed in `config/shield.ts` are validated. With method spoofing
 * enabled, a cross-site POST carrying `_method=GET` in its body would route as POST while
 * Shield saw "GET" — a verb absent from that list — and skip validation entirely.
 *
 * Spoofing is therefore off (config/app.ts). These tests pin both halves of that: the
 * gate cannot be talked out of validating, and a spoofed verb cannot reach another route.
 */
test.group('CSRF cannot be bypassed through method spoofing', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a state-changing POST without a CSRF token is rejected', async ({ client, assert }) => {
    const user = await UserFactory.create()

    const response = await client
      .post('/profile/tokens')
      .form({ name: 'no-csrf' })
      .loginAs(user)
      .redirects(0)

    assert.notEqual(response.status(), 200)

    const tokens = await db.from('auth_access_tokens').where('tokenable_id', user.id)
    assert.lengthOf(tokens, 0)
  })

  test('_method=GET in the body does not talk Shield out of validating', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()

    const response = await client
      .post('/profile/tokens')
      .form({ _method: 'GET', name: 'spoofed-past-shield' })
      .loginAs(user)
      .redirects(0)

    assert.notEqual(response.status(), 200)

    const tokens = await db.from('auth_access_tokens').where('tokenable_id', user.id)
    assert.lengthOf(tokens, 0)
  })

  test('_method in the body cannot reach a route registered for another verb', async ({
    client,
  }) => {
    const user = await UserFactory.create()

    // PUT /profile exists; POST /profile does not.
    const response = await client
      .post('/profile')
      .form({ _method: 'PUT', displayName: 'Spoofed Name' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(404)
  })
})
