import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import UserInvitation from '#models/user_invitation'
import InvitationService from '#services/invitation_service'
import { UserFactory } from '#database/factories/user_factory'
import { store as throttleStore } from '#middleware/throttle_middleware'

test.group('Web Auth - Invitations', (group) => {
  const previousEnv = {
    OIDC_ENABLED: process.env.OIDC_ENABLED,
    LOCAL_LOGIN_DISABLED: process.env.LOCAL_LOGIN_DISABLED,
  }

  group.each.setup(async () => {
    throttleStore.clear()
    await db.from('remember_me_tokens').delete()
    await db.from('user_invitations').delete()
    await db.from('users').delete()

    process.env.OIDC_ENABLED = 'false'
    process.env.LOCAL_LOGIN_DISABLED = 'false'
  })

  group.teardown(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  test('admin can create invitation', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()

    const response = await client
      .post('/admin/invitations')
      .loginAs(admin)
      .form({
        email: 'invited-user@example.com',
        role: 'supplier',
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/admin/users')

    const invite = await UserInvitation.query().where('email', 'invited-user@example.com').first()
    assert.exists(invite)
    assert.equal(invite!.role, 'supplier')
  })

  test('admin invitation rejects invalid email', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()

    const response = await client
      .post('/admin/invitations')
      .loginAs(admin)
      .form({
        email: 'invalid-email',
        role: 'supplier',
      })
      .withCsrfToken()
      .redirects(0)

    assert.include([302, 422], response.status())

    const invite = await UserInvitation.query().where('email', 'invalid-email').first()
    assert.isNull(invite)
  })

  test('admin can revoke invitation', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const service = new InvitationService()
    const { invitation } = await service.createInvite({
      email: 'to-revoke@example.com',
      role: 'customer',
      invitedByUserId: admin.id,
    })

    const response = await client
      .post(`/admin/invitations/${invitation.id}/revoke`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/admin/users')

    await invitation.refresh()
    assert.isNotNull(invitation.revokedAt)
  })

  test('admin users page paginates invitations and includes copy link for pending invite', async ({
    client,
  }) => {
    const admin = await UserFactory.apply('admin').create()
    const service = new InvitationService()

    for (let i = 0; i < 6; i++) {
      await service.createInvite({
        email: `paged-${i}@example.com`,
        role: 'customer',
        invitedByUserId: admin.id,
      })
    }

    const firstPage = await client.get('/admin/users').loginAs(admin)
    firstPage.assertStatus(200)
    firstPage.assertTextIncludes('paged-5@example.com')
    firstPage.assertTextIncludes('/register/invite/sbfv2.')

    const secondPage = await client.get('/admin/users?invitePage=2').loginAs(admin)
    secondPage.assertStatus(200)
    secondPage.assertTextIncludes('paged-0@example.com')
  })

  test('invite accept page renders for valid token', async ({ client }) => {
    const service = new InvitationService()
    const { inviteUrl } = await service.createInvite({
      email: 'accepted-view@example.com',
      role: 'customer',
      invitedByUserId: null,
    })
    const token = inviteUrl.split('/').pop()!

    const response = await client.get(`/register/invite/${token}`)
    response.assertStatus(200)
  })

  test('invite accept page includes OIDC completion link when OIDC is enabled', async ({
    client,
    assert,
  }) => {
    process.env.OIDC_ENABLED = 'true'
    process.env.LOCAL_LOGIN_DISABLED = 'false'

    const service = new InvitationService()
    const { inviteUrl } = await service.createInvite({
      email: 'accepted-via-oidc-view@example.com',
      role: 'customer',
      invitedByUserId: null,
    })
    const token = inviteUrl.split('/').pop()!

    const response = await client
      .get(`/register/invite/${token}`)
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')
    response.assertStatus(200)
    assert.isTrue(response.body().props.oidcEnabled)
  })

  test('invite accept page redirects for invalid token', async ({ client }) => {
    const response = await client.get('/register/invite/not-a-real-token').redirects(0)
    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('accepting invitation creates account and logs user in', async ({ client, assert }) => {
    const service = new InvitationService()
    const { invitation, inviteUrl } = await service.createInvite({
      email: 'new-customer@example.com',
      role: 'customer',
      invitedByUserId: null,
    })
    const token = inviteUrl.split('/').pop()!

    const response = await client
      .post(`/register/invite/${token}`)
      .form({
        displayName: 'New Customer',
        password: 'secret12345',
        passwordConfirmation: 'secret12345',
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/shop')

    await invitation.refresh()
    assert.isNotNull(invitation.acceptedAt)

    const user = await User.findBy('email', 'new-customer@example.com')
    assert.exists(user)
    assert.equal(user!.email, 'new-customer@example.com')
  })

  test('cannot accept a revoked invitation', async ({ client }) => {
    const service = new InvitationService()
    const { invitation, inviteUrl } = await service.createInvite({
      email: 'revoked@example.com',
      role: 'customer',
      invitedByUserId: null,
    })
    await service.revokeInvite(invitation.id)
    const token = inviteUrl.split('/').pop()!

    const response = await client
      .post(`/register/invite/${token}`)
      .form({
        displayName: 'Revoked User',
        password: 'secret12345',
        passwordConfirmation: 'secret12345',
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('invite acceptance rejects short password payload', async ({ client, assert }) => {
    const service = new InvitationService()
    const { invitation, inviteUrl } = await service.createInvite({
      email: 'invalid-fields@example.com',
      role: 'customer',
      invitedByUserId: null,
    })
    const token = inviteUrl.split('/').pop()!

    const response = await client
      .post(`/register/invite/${token}`)
      .form({
        displayName: 'Invalid Invite User',
        password: 'short',
        passwordConfirmation: 'short',
      })
      .withCsrfToken()
      .redirects(0)

    assert.include([302, 422], response.status())

    await invitation.refresh()
    assert.isNull(invitation.acceptedAt)

    const created = await User.findBy('email', 'invalid-fields@example.com')
    assert.isNull(created)
  })
})
