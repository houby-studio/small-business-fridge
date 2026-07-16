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
