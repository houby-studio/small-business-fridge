import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import KeypadIdService from '#services/keypad_id_service'

test.group('KeypadIdService', (group) => {
  group.each.setup(async () => {
    await db.rawQuery(
      'TRUNCATE TABLE user_auth_identities, user_invitations, password_reset_tokens, orders, deliveries, invoices, products, categories, users RESTART IDENTITY CASCADE'
    )
  })

  test('returns 1 when there are no users', async ({ assert }) => {
    const service = new KeypadIdService()
    const keypadId = await service.getNextAvailableUserKeypadId()
    assert.equal(keypadId, 1)
  })

  test('fills the lowest hole instead of using max + 1', async ({ assert }) => {
    await User.create({
      displayName: 'User One',
      email: 'user1@example.com',
      password: 'secret12345',
      keypadId: 1,
      role: 'customer',
    })
    await User.create({
      displayName: 'User Three',
      email: 'user3@example.com',
      password: 'secret12345',
      keypadId: 3,
      role: 'customer',
    })

    const service = new KeypadIdService()
    const keypadId = await service.getNextAvailableUserKeypadId()
    assert.equal(keypadId, 2)
  })

  test('ignores migration placeholder keypad 89999 when choosing next ID', async ({ assert }) => {
    await User.create({
      displayName: 'User One',
      email: 'user1@example.com',
      password: 'secret12345',
      keypadId: 1,
      role: 'customer',
    })
    await User.create({
      displayName: 'Migration Placeholder',
      email: 'migration@anon',
      password: null,
      keypadId: 89999,
      role: 'customer',
      isDisabled: true,
    })

    const service = new KeypadIdService()
    const keypadId = await service.getNextAvailableUserKeypadId()
    assert.equal(keypadId, 2)
  })
})
