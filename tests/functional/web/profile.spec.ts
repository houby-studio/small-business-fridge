import '#tests/test_context'
import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('user_favorites').delete()
  await db.from('auth_access_tokens').delete()
  await db.from('users').delete()
}

test.group('Web Profile - color mode toggle', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('POST /profile/color-mode saves dark mode and redirects', async ({ client, assert }) => {
    const user = await UserFactory.merge({ colorMode: 'light' }).create()

    const response = await client
      .post('/profile/color-mode')
      .json({ colorMode: 'dark' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const updated = await User.findOrFail(user.id)
    assert.equal(updated.colorMode, 'dark')

    const log = await db
      .from('audit_logs')
      .where('action', 'profile.updated')
      .where('user_id', user.id)
      .orderBy('id', 'desc')
      .first()
    assert.isDefined(log)
    const metadata = log.metadata as { colorMode?: { from: string; to: string } } | null
    assert.deepEqual(metadata?.colorMode, { from: 'light', to: 'dark' })
  })

  test('POST /profile/color-mode saves light mode and redirects', async ({ client, assert }) => {
    const user = await UserFactory.merge({ colorMode: 'dark' }).create()

    const response = await client
      .post('/profile/color-mode')
      .json({ colorMode: 'light' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const updated = await User.findOrFail(user.id)
    assert.equal(updated.colorMode, 'light')
  })

  test('POST /profile/color-mode rejects invalid value and does not update', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.merge({ colorMode: 'light' }).create()

    const response = await client
      .post('/profile/color-mode')
      .json({ colorMode: 'auto' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    // Inertia validation failure redirects back
    response.assertStatus(302)

    // colorMode should not have changed
    const updated = await User.findOrFail(user.id)
    assert.equal(updated.colorMode, 'light')
  })

  test('POST /profile/color-mode requires authentication', async ({ client }) => {
    const response = await client
      .post('/profile/color-mode')
      .json({ colorMode: 'dark' })
      .redirects(0)

    response.assertStatus(302)
  })
})

test.group('Web Profile - update audit details', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('PUT /profile stores field-level metadata for changed values', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.merge({
      displayName: 'Alice Old',
      email: 'alice.old@example.com',
      phone: '111',
      iban: 'CZ6508000000192000145399',
      showAllProducts: false,
      sendMailOnPurchase: true,
      sendDailyReport: true,
      colorMode: 'dark',
      keypadDisabled: false,
    }).create()

    const response = await client
      .put('/profile')
      .json({
        displayName: 'Alice New',
        email: 'alice.new@example.com',
        currentPassword: 'password123',
        phone: '222',
        iban: 'CZ6508000000192000145400',
        showAllProducts: true,
        sendMailOnPurchase: false,
        sendDailyReport: false,
        colorMode: 'light',
        keypadDisabled: true,
      })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    await user.refresh()
    assert.equal(user.email, 'alice.old@example.com')
    assert.equal(user.pendingEmail, 'alice.new@example.com')

    const log = await db
      .from('audit_logs')
      .where('action', 'profile.updated')
      .where('user_id', user.id)
      .orderBy('id', 'desc')
      .first()
    assert.isDefined(log)

    const metadata = log.metadata as Record<string, { from: unknown; to: unknown }> | null
    assert.deepEqual(metadata?.displayName, { from: 'Alice Old', to: 'Alice New' })
    assert.deepEqual(metadata?.pendingEmail, {
      from: null,
      to: 'alice.new@example.com',
    })
    assert.deepEqual(metadata?.phone, { from: '111', to: '222' })
    assert.deepEqual(metadata?.pendingIban, {
      from: null,
      to: 'CZ6508000000192000145400',
    })
    assert.deepEqual(metadata?.showAllProducts, { from: false, to: true })
    assert.deepEqual(metadata?.sendMailOnPurchase, { from: true, to: false })
    assert.deepEqual(metadata?.sendDailyReport, { from: true, to: false })
    assert.deepEqual(metadata?.colorMode, { from: 'dark', to: 'light' })
    assert.deepEqual(metadata?.keypadDisabled, { from: false, to: true })
  })

  test('PUT /profile accepts one-time sensitive stepup grant when TTL is zero', async ({
    client,
    assert,
  }) => {
    const previousTtl = process.env.SENSITIVE_ACTION_REAUTH_TTL_MINUTES
    process.env.SENSITIVE_ACTION_REAUTH_TTL_MINUTES = '0'

    try {
      const user = await UserFactory.merge({
        displayName: 'Grant User',
        email: 'grant@example.com',
        iban: 'CZ6508000000192000145399',
      }).create()

      const response = await client
        .put('/profile')
        .json({
          displayName: user.displayName,
          email: user.email,
          phone: user.phone,
          iban: 'CZ6508000000192000145400',
          showAllProducts: user.showAllProducts,
          sendMailOnPurchase: user.sendMailOnPurchase,
          sendDailyReport: user.sendDailyReport,
          colorMode: user.colorMode,
          keypadDisabled: user.keypadDisabled,
          excludedAllergenIds: [],
        })
        .loginAs(user)
        .withSession({
          __sensitive_stepup_grant: {
            userId: user.id,
            issuedAt: new Date().toISOString(),
          },
        })
        .withCsrfToken()
        .redirects(0)

      response.assertStatus(302)

      await user.refresh()
      assert.equal(user.iban, 'CZ6508000000192000145399')
      assert.equal(user.pendingIban, 'CZ6508000000192000145400')
    } finally {
      if (previousTtl === undefined) {
        delete process.env.SENSITIVE_ACTION_REAUTH_TTL_MINUTES
      } else {
        process.env.SENSITIVE_ACTION_REAUTH_TTL_MINUTES = previousTtl
      }
    }
  })
})

test.group('Web Profile - API tokens', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('POST /profile/tokens creates a token and redirects', async ({ client, assert }) => {
    const user = await UserFactory.create()

    const response = await client
      .post('/profile/tokens')
      .json({ name: 'My home automation' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const tokens = await db
      .from('auth_access_tokens')
      .where('tokenable_id', user.id)
      .where('name', 'My home automation')

    assert.lengthOf(tokens, 1)
  })

  test('POST /profile/tokens with expiry stores expires_at', async ({ client, assert }) => {
    const user = await UserFactory.create()

    const response = await client
      .post('/profile/tokens')
      .json({ name: 'Expiring token', expiresInDays: 30 })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const token = await db
      .from('auth_access_tokens')
      .where('tokenable_id', user.id)
      .where('name', 'Expiring token')
      .first()

    assert.isNotNull(token)
    assert.isNotNull(token.expires_at)
  })

  test('DELETE /profile/tokens/:id revokes own token', async ({ client, assert }) => {
    const user = await UserFactory.create()

    // Create a token first
    const token = await User.accessTokens.create(user, ['*'], { name: 'to-revoke' })

    const response = await client
      .delete(`/profile/tokens/${token.identifier}`)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const remaining = await db.from('auth_access_tokens').where('id', String(token.identifier))

    assert.lengthOf(remaining, 0)
  })

  test('DELETE /profile/tokens/:id cannot revoke another user token', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()
    const other = await UserFactory.create()

    const otherToken = await User.accessTokens.create(other, ['*'], { name: 'other-token' })

    const response = await client
      .delete(`/profile/tokens/${otherToken.identifier}`)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    // Redirects with not_found error
    response.assertStatus(302)

    // Token still exists
    const remaining = await db.from('auth_access_tokens').where('id', String(otherToken.identifier))
    assert.lengthOf(remaining, 1)
  })

  test('GET /profile renders profile page with token list', async ({ client }) => {
    const user = await UserFactory.create()
    await User.accessTokens.create(user, ['*'], { name: 'my-personal-token' })

    const response = await client.get('/profile').loginAs(user)
    response.assertStatus(200)
  })
})

test.group('Web Profile - update preferences', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('PUT /profile/preferences saves boolean preferences and redirects', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.merge({
      showAllProducts: false,
      sendMailOnPurchase: true,
      sendDailyReport: true,
      colorMode: 'light',
      keypadDisabled: false,
    }).create()

    const response = await client
      .put('/profile/preferences')
      .json({
        showAllProducts: true,
        sendMailOnPurchase: false,
        sendDailyReport: false,
        colorMode: 'dark',
        keypadDisabled: true,
        excludedAllergenIds: [],
      })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const updated = await User.findOrFail(user.id)
    assert.isTrue(updated.showAllProducts)
    assert.isFalse(updated.sendMailOnPurchase)
    assert.isFalse(updated.sendDailyReport)
    assert.equal(updated.colorMode, 'dark')
    assert.isTrue(updated.keypadDisabled)
  })

  test('PUT /profile/preferences audit logs changed fields', async ({ client, assert }) => {
    const user = await UserFactory.merge({
      showAllProducts: false,
      sendMailOnPurchase: true,
      sendDailyReport: false,
      colorMode: 'light',
      keypadDisabled: false,
    }).create()

    await client
      .put('/profile/preferences')
      .json({
        showAllProducts: true,
        sendMailOnPurchase: true,
        sendDailyReport: false,
        colorMode: 'dark',
        keypadDisabled: false,
        excludedAllergenIds: [],
      })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    const log = await db
      .from('audit_logs')
      .where('action', 'profile.updated')
      .where('user_id', user.id)
      .orderBy('id', 'desc')
      .first()

    assert.isDefined(log)
    const metadata = log.metadata as Record<string, { from: unknown; to: unknown }> | null
    assert.deepEqual(metadata?.showAllProducts, { from: false, to: true })
    assert.deepEqual(metadata?.colorMode, { from: 'light', to: 'dark' })
    assert.isUndefined(metadata?.sendMailOnPurchase)
    assert.isUndefined(metadata?.sendDailyReport)
    assert.isUndefined(metadata?.keypadDisabled)
  })

  test('PUT /profile/preferences rejects invalid colorMode', async ({ client, assert }) => {
    const user = await UserFactory.merge({ colorMode: 'light' }).create()

    const response = await client
      .put('/profile/preferences')
      .json({
        showAllProducts: false,
        sendMailOnPurchase: false,
        sendDailyReport: false,
        colorMode: 'auto',
        keypadDisabled: false,
        excludedAllergenIds: [],
      })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const updated = await User.findOrFail(user.id)
    assert.equal(updated.colorMode, 'light')
  })

  test('PUT /profile/preferences requires authentication', async ({ client }) => {
    const response = await client
      .put('/profile/preferences')
      .json({
        showAllProducts: false,
        sendMailOnPurchase: false,
        sendDailyReport: false,
        colorMode: 'light',
        keypadDisabled: false,
        excludedAllergenIds: [],
      })
      .redirects(0)

    response.assertStatus(302)
  })
})
