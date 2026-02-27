import '#tests/test_context'
import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import UserInvitation from '#models/user_invitation'
import InvitationService from '#services/invitation_service'

test.group('InvitationService', (group) => {
  group.each.setup(async () => {
    await db.rawQuery(
      'TRUNCATE TABLE user_invitations, password_reset_tokens, orders, deliveries, invoices, products, categories, users RESTART IDENTITY CASCADE'
    )
  })

  test('createInvite persists invite with hashed token and normalized email', async ({
    assert,
  }) => {
    const service = new InvitationService()
    const { invitation, inviteUrl } = await service.createInvite({
      email: '  New.User@Example.COM ',
      role: 'customer',
      invitedByUserId: null,
    })

    const token = inviteUrl.split('/').pop()!
    const row = await UserInvitation.findOrFail(invitation.id)

    assert.equal(row.email, 'new.user@example.com')
    assert.equal(row.role, 'customer')
    assert.notEqual(row.tokenHash, token)
    assert.isTrue(row.expiresAt.toMillis() > DateTime.now().toMillis())
  })

  test('validateToken returns expired status for old invite', async ({ assert }) => {
    const service = new InvitationService()
    const { invitation, inviteUrl } = await service.createInvite({
      email: 'expired@example.com',
      role: 'customer',
      invitedByUserId: null,
    })

    invitation.expiresAt = DateTime.now().minus({ minutes: 1 })
    await invitation.save()

    const token = inviteUrl.split('/').pop()!
    const status = await service.validateToken(token)
    assert.deepEqual(status, { valid: false, reason: 'expired' })
  })

  test('acceptInvite creates user and marks invitation as accepted', async ({ assert }) => {
    const service = new InvitationService()
    const { invitation, inviteUrl } = await service.createInvite({
      email: 'accepted@example.com',
      role: 'supplier',
      invitedByUserId: null,
    })

    const token = inviteUrl.split('/').pop()!
    const user = await service.acceptInvite({
      token,
      displayName: 'Accepted User',
      username: 'accepted-user',
      password: 'secret12345',
    })

    await invitation.refresh()

    assert.equal(user.email, 'accepted@example.com')
    assert.equal(user.role, 'supplier')
    assert.isNotNull(invitation.acceptedAt)
    assert.equal(invitation.acceptedUserId, user.id)
  })

  test('createInvite rejects email already registered by existing user', async ({ assert }) => {
    await User.create({
      displayName: 'Existing',
      email: 'existing@example.com',
      username: 'existing',
      password: 'secret12345',
      keypadId: 7000,
      role: 'customer',
    })

    const service = new InvitationService()

    await assert.rejects(
      () =>
        service.createInvite({
          email: 'existing@example.com',
          role: 'customer',
          invitedByUserId: null,
        }),
      /EMAIL_ALREADY_REGISTERED/
    )
  })
})
