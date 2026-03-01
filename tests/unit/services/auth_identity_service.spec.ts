import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import AuthIdentityService from '#services/auth_identity_service'

const service = new AuthIdentityService()

test.group('AuthIdentityService', (group) => {
  group.each.setup(async () => {
    await db.from('user_auth_identities').delete()
    await db.from('users').delete()
  })

  test('matches user by linked provider identity first', async ({ assert }) => {
    const user = await UserFactory.create()
    await service.ensureLinkedIdentity({
      userId: user.id,
      provider: 'microsoft',
      providerUserId: 'ms-1',
      providerEmail: 'linked@example.com',
    })

    const match = await service.resolveForLogin({
      provider: 'microsoft',
      providerUserId: 'ms-1',
      email: 'other@example.com',
    })

    assert.equal(match.kind, 'matched')
    if (match.kind === 'matched') {
      assert.equal(match.user.id, user.id)
      assert.equal(match.via, 'provider')
    }
  })

  test('links by unique email when no provider identity exists', async ({ assert }) => {
    const user = await UserFactory.merge({ email: 'unique@example.com' }).create()
    const match = await service.resolveForLogin({
      provider: 'discord',
      providerUserId: 'dc-1',
      email: 'unique@example.com',
    })

    assert.equal(match.kind, 'matched')
    if (match.kind === 'matched') {
      assert.equal(match.user.id, user.id)
      assert.equal(match.via, 'email_linked')
    }
  })

  test('returns not_found when neither provider identity nor email matches', async ({ assert }) => {
    const match = await service.resolveForLogin({
      provider: 'discord',
      providerUserId: 'dc-2',
      email: 'nobody@example.com',
    })

    assert.equal(match.kind, 'not_found')
  })

  test('prevents linking same provider identity to different users', async ({ assert }) => {
    const first = await UserFactory.create()
    const second = await UserFactory.create()

    await service.ensureLinkedIdentity({
      userId: first.id,
      provider: 'microsoft',
      providerUserId: 'ms-shared',
      providerEmail: 'first@example.com',
    })

    await assert.rejects(
      () =>
        service.ensureLinkedIdentity({
          userId: second.id,
          provider: 'microsoft',
          providerUserId: 'ms-shared',
          providerEmail: 'second@example.com',
        }),
      /PROVIDER_IDENTITY_ALREADY_LINKED/
    )
  })
})
