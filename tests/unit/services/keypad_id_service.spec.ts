import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import KeypadIdService from '#services/keypad_id_service'
import { reservedUserKeypadIds } from '#helpers/kiosk_codes'
import env from '#start/env'

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

  test('never hands out the kiosk easter egg code 666', async ({ assert }) => {
    // Occupy 1..665 so 666 would be the lowest free ID.
    await db.rawQuery(
      `INSERT INTO users (display_name, email, role, keypad_id, created_at, updated_at)
       SELECT 'User ' || g, 'user' || g || '@example.com', 'customer', g, NOW(), NOW()
       FROM generate_series(1, 665) AS g`
    )

    const service = new KeypadIdService()
    assert.equal(await service.getNextAvailableUserKeypadId(), 667)
  })

  test('never hands out a numeric kiosk logout code', async ({ assert }) => {
    const previous = env.get('KIOSK_LOGOUT_CODE')
    env.set('KIOSK_LOGOUT_CODE', '2')
    try {
      await User.create({
        displayName: 'User One',
        email: 'user1@example.com',
        password: 'secret12345',
        keypadId: 1,
        role: 'customer',
      })

      const service = new KeypadIdService()
      assert.equal(await service.getNextAvailableUserKeypadId(), 3)
    } finally {
      env.set('KIOSK_LOGOUT_CODE', previous ?? '000000')
    }
  })
})

test.group('Kiosk reserved codes', () => {
  test('reservedUserKeypadIds covers the easter egg and a numeric logout code only', ({
    assert,
  }) => {
    const previous = env.get('KIOSK_LOGOUT_CODE')
    try {
      env.set('KIOSK_LOGOUT_CODE', '000000')
      assert.deepEqual(reservedUserKeypadIds(), [666])
      env.set('KIOSK_LOGOUT_CODE', '0123')
      assert.deepEqual(reservedUserKeypadIds(), [666])
      env.set('KIOSK_LOGOUT_CODE', '4321')
      assert.deepEqual(reservedUserKeypadIds(), [666, 4321])
    } finally {
      env.set('KIOSK_LOGOUT_CODE', previous ?? '000000')
    }
  })
})
