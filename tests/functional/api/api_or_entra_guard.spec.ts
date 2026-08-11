import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { store as throttleStore } from '#middleware/throttle_middleware'
import User from '#models/user'
import { entraIdJwtVerifier } from '#services/entra_id_jwt_verifier'

const cleanAll = async () => {
  await db.from('user_favorites').delete()
  await db.from('orders').delete()
  await db.from('deliveries').delete()
  await db.from('auth_access_tokens').delete()
  await db.from('user_auth_identities').delete()
  await db.from('users').delete()
}

// A three-segment token so looksLikeJwt() routes it down the Entra verification path.
const JWT_SHAPED = 'header.payload.signature'

test.group('api_or_entra guard', (group) => {
  const originalResolveUser = entraIdJwtVerifier.resolveUser.bind(entraIdJwtVerifier)

  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(async () => {
    entraIdJwtVerifier.resolveUser = originalResolveUser
    await cleanAll()
  })

  test('accepts a valid Entra ID JWT and resolves auth.user to the linked user', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()
    // Stub the JWKS/oid resolution so the test needs no real Microsoft token.
    entraIdJwtVerifier.resolveUser = async (token: string) => (token === JWT_SHAPED ? user : null)

    const response = await client
      .get('/api/v1/products')
      .header('authorization', `Bearer ${JWT_SHAPED}`)

    response.assertStatus(200)
    assert.property(response.body(), 'data')
  })

  test('rejects a JWT that does not resolve to a linked user', async ({ client }) => {
    entraIdJwtVerifier.resolveUser = async () => null

    const response = await client
      .get('/api/v1/products')
      .header('authorization', `Bearer ${JWT_SHAPED}`)

    response.assertStatus(401)
  })

  test('still accepts an opaque personal API token (regression)', async ({ client, assert }) => {
    const user = await UserFactory.create()
    const token = await User.accessTokens.create(user, ['*'], {
      name: 'test-api-token',
      expiresIn: '30 days',
    })

    const response = await client
      .get('/api/v1/products')
      .header('authorization', `Bearer ${token.value!.release()}`)

    response.assertStatus(200)
    assert.property(response.body(), 'data')
  })

  test('rejects a request with no Authorization header', async ({ client }) => {
    const response = await client.get('/api/v1/products')
    response.assertStatus(401)
  })
})

test.group('api guard rejects disabled accounts', (group) => {
  const originalResolveUser = entraIdJwtVerifier.resolveUser.bind(entraIdJwtVerifier)

  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(async () => {
    entraIdJwtVerifier.resolveUser = originalResolveUser
    await cleanAll()
  })

  test('an opaque token issued before the account was disabled stops working', async ({
    client,
  }) => {
    const user = await UserFactory.create()
    const token = await User.accessTokens.create(user, ['*'], { name: 'before-disable' })
    const raw = token.value!.release()

    // Sanity: the token works while the account is live.
    const before = await client.get('/api/v1/products').header('authorization', `Bearer ${raw}`)
    before.assertStatus(200)

    user.isDisabled = true
    await user.save()

    const after = await client.get('/api/v1/products').header('authorization', `Bearer ${raw}`)
    after.assertStatus(401)
  })

  test('an Entra JWT resolving to a disabled user is rejected', async ({ client }) => {
    const user = await UserFactory.apply('disabled').create()
    entraIdJwtVerifier.resolveUser = async (token: string) => (token === JWT_SHAPED ? user : null)

    const response = await client
      .get('/api/v1/products')
      .header('authorization', `Bearer ${JWT_SHAPED}`)

    response.assertStatus(401)
  })

  test('disabling an account revokes its API tokens and remember-me tokens', async ({
    client,
    assert,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const user = await UserFactory.create()
    await User.accessTokens.create(user, ['*'], { name: 'doomed' })
    await db.table('remember_me_tokens').insert({
      tokenable_id: user.id,
      hash: 'deadbeef',
      created_at: new Date(),
      updated_at: new Date(),
      expires_at: new Date(Date.now() + 86_400_000),
    })

    const response = await client
      .put(`/admin/users/${user.id}`)
      .form({ isDisabled: true })
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const apiTokens = await db.from('auth_access_tokens').where('tokenable_id', user.id)
    const rememberTokens = await db.from('remember_me_tokens').where('tokenable_id', user.id)
    assert.lengthOf(apiTokens, 0)
    assert.lengthOf(rememberTokens, 0)
  })
})
