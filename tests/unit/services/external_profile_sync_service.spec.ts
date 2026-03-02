import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import User from '#models/user'
import ExternalProfileSyncService from '#services/external_profile_sync_service'

const service = new ExternalProfileSyncService()

test.group('ExternalProfileSyncService', (group) => {
  group.each.setup(async () => {
    await db.from('users').delete()
  })

  test('does not overwrite displayName or email from provider login', async ({ assert }) => {
    const user = await UserFactory.merge({
      displayName: 'Local Name',
      email: 'local@example.com',
      phone: null,
    }).create()

    await service.syncAfterExternalLogin(user, {
      phone: null,
    })

    const refreshed = await User.findOrFail(user.id)
    assert.equal(refreshed.displayName, 'Local Name')
    assert.equal(refreshed.email, 'local@example.com')
  })

  test('backfills phone when user phone is empty', async ({ assert }) => {
    const user = await UserFactory.merge({ phone: null }).create()

    await service.syncAfterExternalLogin(user, {
      phone: '+1-555-111',
    })

    const refreshed = await User.findOrFail(user.id)
    assert.equal(refreshed.phone, '+1-555-111')
  })

  test('does not overwrite existing phone', async ({ assert }) => {
    const user = await UserFactory.merge({ phone: '+1-555-222' }).create()

    await service.syncAfterExternalLogin(user, {
      phone: '+1-555-333',
    })

    const refreshed = await User.findOrFail(user.id)
    assert.equal(refreshed.phone, '+1-555-222')
  })
})
