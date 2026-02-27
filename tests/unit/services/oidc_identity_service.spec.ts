import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import OidcIdentityService from '#services/oidc_identity_service'

const oidcIdentityService = new OidcIdentityService()

const cleanAll = async () => {
  await db.from('auth_access_tokens').delete()
  await db.from('remember_me_tokens').delete()
  await db.from('users').delete()
}

test.group('OidcIdentityService', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('matches user by OID first even when email could match another user', async ({ assert }) => {
    const byOid = await UserFactory.merge({
      oid: 'oid-user-1',
      email: 'first@example.com',
    }).create()

    const byEmail = await UserFactory.merge({
      oid: null,
      email: 'second@example.com',
    }).create()

    const match = await oidcIdentityService.resolve({
      oid: 'oid-user-1',
      email: 'second@example.com',
    })

    assert.equal(match.kind, 'matched')
    if (match.kind === 'matched') {
      assert.equal(match.user.id, byOid.id)
      assert.equal(match.via, 'oid')
      assert.notEqual(match.user.id, byEmail.id)
    }
  })

  test('links user by unique email when OID is new and local user has no OID', async ({
    assert,
  }) => {
    const local = await UserFactory.merge({
      oid: null,
      email: 'linkme@example.com',
    }).create()

    const match = await oidcIdentityService.resolve({
      oid: 'oid-link-1',
      email: 'linkme@example.com',
    })

    assert.equal(match.kind, 'matched')
    if (match.kind === 'matched') {
      assert.equal(match.user.id, local.id)
      assert.equal(match.via, 'email_linked')
    }
  })

  test('matches email case-insensitively during fallback', async ({ assert }) => {
    const local = await UserFactory.merge({
      oid: null,
      email: 'MixedCase@Example.Com',
    }).create()

    const match = await oidcIdentityService.resolve({
      oid: 'oid-case-1',
      email: 'mixedcase@example.com',
    })

    assert.equal(match.kind, 'matched')
    if (match.kind === 'matched') {
      assert.equal(match.user.id, local.id)
      assert.equal(match.via, 'email_linked')
    }
  })

  test('rejects email fallback when local user has different OID', async ({ assert }) => {
    const local = await UserFactory.merge({
      oid: 'oid-existing',
      email: 'conflict@example.com',
    }).create()

    const match = await oidcIdentityService.resolve({
      oid: 'oid-incoming',
      email: 'conflict@example.com',
    })

    assert.equal(match.kind, 'oid_conflict')
    if (match.kind === 'oid_conflict') {
      assert.equal(match.userId, local.id)
    }
  })

  test('rejects email-only login when provider does not return OID', async ({ assert }) => {
    await UserFactory.merge({
      oid: null,
      email: 'emailonly@example.com',
    }).create()

    const match = await oidcIdentityService.resolve({
      oid: null,
      email: 'emailonly@example.com',
    })

    assert.equal(match.kind, 'missing_oid')
  })

  test('returns not_found when OID and email do not map to any user', async ({ assert }) => {
    const match = await oidcIdentityService.resolve({
      oid: 'oid-missing',
      email: 'missing@example.com',
    })

    assert.equal(match.kind, 'not_found')
  })
})
