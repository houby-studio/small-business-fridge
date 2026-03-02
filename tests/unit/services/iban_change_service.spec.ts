import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import IbanChangeService from '#services/iban_change_service'

const service = new IbanChangeService()

test.group('IbanChangeService', (group) => {
  group.each.setup(async () => {
    await db.from('iban_change_tokens').delete()
    await db.from('users').delete()
  })

  test('applies pending IBAN from a valid token', async ({ assert }) => {
    const user = await UserFactory.merge({ iban: 'CZ6508000000192000145399' }).create()
    user.pendingIban = 'CZ6508000000192000145400'
    await user.save()

    const payload = await service.createToken(user, user.pendingIban)
    const rawToken = payload.verificationUrl.split('/').pop()!
    const result = await service.consumeToken(rawToken)

    assert.isTrue(result.ok)

    await user.refresh()
    assert.equal(user.iban, 'CZ6508000000192000145400')
    assert.isNull(user.pendingIban)
    assert.isNotNull(user.ibanVerifiedAt)
  })

  test('createForPendingIban returns null when nothing is pending', async ({ assert }) => {
    const user = await UserFactory.create()
    const payload = await service.createForPendingIban(user)
    assert.isNull(payload)
  })
})
