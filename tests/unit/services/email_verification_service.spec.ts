import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { UserFactory } from '#database/factories/user_factory'
import EmailVerificationService from '#services/email_verification_service'

const service = new EmailVerificationService()

test.group('EmailVerificationService', (group) => {
  group.each.setup(async () => {
    await db.from('email_verification_tokens').delete()
    await db.from('users').delete()
  })

  test('verifies current email from token', async ({ assert }) => {
    const user = await UserFactory.merge({ emailVerifiedAt: null }).create()

    const payload = await service.createToken(user, user.email)
    const rawToken = payload.verificationUrl.split('/').pop()!
    const result = await service.consumeToken(rawToken)

    assert.isTrue(result.ok)
    if (result.ok) {
      assert.equal(result.action, 'verified_current')
    }

    await user.refresh()
    assert.isNotNull(user.emailVerifiedAt)
  })

  test('applies pending email when verification token is consumed', async ({ assert }) => {
    const user = await UserFactory.merge({ emailVerifiedAt: null }).create()
    user.pendingEmail = 'pending-change@example.com'
    await user.save()

    const payload = await service.createToken(user, user.pendingEmail)
    const rawToken = payload.verificationUrl.split('/').pop()!
    const result = await service.consumeToken(rawToken)

    assert.isTrue(result.ok)
    if (result.ok) {
      assert.equal(result.action, 'applied_pending')
    }

    await user.refresh()
    assert.equal(user.email, 'pending-change@example.com')
    assert.isNull(user.pendingEmail)
    assert.isNotNull(user.emailVerifiedAt)
  })

  test('returns email_taken when pending email was claimed by another account', async ({
    assert,
  }) => {
    const user = await UserFactory.merge({ emailVerifiedAt: null }).create()
    user.pendingEmail = 'already-used@example.com'
    await user.save()

    await UserFactory.merge({ email: 'already-used@example.com' }).create()

    const payload = await service.createToken(user, user.pendingEmail)
    const rawToken = payload.verificationUrl.split('/').pop()!
    const result = await service.consumeToken(rawToken)

    assert.isFalse(result.ok)
    if (!result.ok) {
      assert.equal(result.reason, 'email_taken')
    }

    const unchanged = await User.findOrFail(user.id)
    assert.notEqual(unchanged.email, 'already-used@example.com')
    assert.equal(unchanged.pendingEmail, 'already-used@example.com')
  })

  test('createForCurrentOrPendingEmail skips already verified email without pending change', async ({
    assert,
  }) => {
    const user = await UserFactory.create()
    const payload = await service.createForCurrentOrPendingEmail(user)
    assert.isNull(payload)
  })
})
