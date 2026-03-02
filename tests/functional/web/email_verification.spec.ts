import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { UserFactory } from '#database/factories/user_factory'
import IbanChangeService from '#services/iban_change_service'

const previousRequired = process.env.AUTH_EMAIL_VERIFICATION_REQUIRED
const previousProviders = process.env.AUTH_PROVIDERS

const cleanAll = async () => {
  await db.from('iban_change_tokens').delete()
  await db.from('email_verification_tokens').delete()
  await db.from('user_auth_identities').delete()
  await db.from('remember_me_tokens').delete()
  await db.from('users').delete()
}

test.group('Web Email Verification', (group) => {
  group.each.setup(async () => {
    await cleanAll()
    process.env.AUTH_PROVIDERS = 'local'
  })

  group.teardown(() => {
    if (previousRequired === undefined) {
      delete process.env.AUTH_EMAIL_VERIFICATION_REQUIRED
    } else {
      process.env.AUTH_EMAIL_VERIFICATION_REQUIRED = previousRequired
    }

    if (previousProviders === undefined) {
      delete process.env.AUTH_PROVIDERS
    } else {
      process.env.AUTH_PROVIDERS = previousProviders
    }
  })

  test('redirects unverified user from app pages when enforcement is enabled', async ({
    client,
  }) => {
    process.env.AUTH_EMAIL_VERIFICATION_REQUIRED = 'true'

    const user = await UserFactory.merge({ emailVerifiedAt: null }).create()

    const response = await client.get('/shop').loginAs(user).redirects(0)
    response.assertStatus(302)
    response.assertHeader('location', '/profile')
  })

  test('allows verified user to app pages when enforcement is enabled', async ({ client }) => {
    process.env.AUTH_EMAIL_VERIFICATION_REQUIRED = 'true'

    const user = await UserFactory.create()

    const response = await client.get('/shop').loginAs(user)
    response.assertStatus(200)
  })

  test('registers local account as unverified and redirects to profile when enforcement is enabled', async ({
    client,
    assert,
  }) => {
    process.env.AUTH_EMAIL_VERIFICATION_REQUIRED = 'true'

    await UserFactory.apply('admin').create()

    const response = await client
      .post('/register')
      .form({
        displayName: 'Local New User',
        email: 'local-unverified@example.com',
        password: 'secret12345',
        passwordConfirmation: 'secret12345',
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/profile')

    const user = await User.findByOrFail('email', 'local-unverified@example.com')
    assert.isNull(user.emailVerifiedAt)

    const tokens = await db.from('email_verification_tokens').where('user_id', user.id)
    assert.isAtLeast(tokens.length, 1)
  })

  test('profile email update keeps active email and stores pending email for verification', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.merge({
      displayName: 'Email Pending User',
      email: 'active@example.com',
      phone: '123',
      iban: null,
      showAllProducts: false,
      sendMailOnPurchase: true,
      sendDailyReport: true,
      colorMode: 'dark',
      keypadDisabled: false,
    }).create()

    const response = await client
      .put('/profile')
      .json({
        displayName: user.displayName,
        email: 'pending@example.com',
        currentPassword: 'password123',
        phone: user.phone,
        iban: user.iban,
        showAllProducts: user.showAllProducts,
        sendMailOnPurchase: user.sendMailOnPurchase,
        sendDailyReport: user.sendDailyReport,
        colorMode: user.colorMode,
        keypadDisabled: user.keypadDisabled,
        excludedAllergenIds: [],
      })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    await user.refresh()
    assert.equal(user.email, 'active@example.com')
    assert.equal(user.pendingEmail, 'pending@example.com')

    const token = await db
      .from('email_verification_tokens')
      .where('user_id', user.id)
      .where('email', 'pending@example.com')
      .first()
    assert.isNotNull(token)
  })

  test('profile email update is denied without step-up reauth', async ({ client, assert }) => {
    const user = await UserFactory.merge({
      displayName: 'Email Stepup User',
      email: 'stepup@example.com',
      phone: null,
      iban: null,
      showAllProducts: false,
      sendMailOnPurchase: true,
      sendDailyReport: true,
      colorMode: 'dark',
      keypadDisabled: false,
    }).create()

    const response = await client
      .put('/profile')
      .json({
        displayName: user.displayName,
        email: 'stepup-new@example.com',
        phone: user.phone,
        iban: user.iban,
        showAllProducts: user.showAllProducts,
        sendMailOnPurchase: user.sendMailOnPurchase,
        sendDailyReport: user.sendDailyReport,
        colorMode: user.colorMode,
        keypadDisabled: user.keypadDisabled,
        excludedAllergenIds: [],
      })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    await user.refresh()
    assert.equal(user.email, 'stepup@example.com')
    assert.isNull(user.pendingEmail)
  })

  test('profile email update immediately applies trusted linked provider email', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.merge({
      displayName: 'Trusted Provider User',
      email: 'active@example.com',
      phone: null,
      iban: null,
      showAllProducts: false,
      sendMailOnPurchase: true,
      sendDailyReport: true,
      colorMode: 'dark',
      keypadDisabled: false,
    }).create()

    await db.table('user_auth_identities').insert({
      user_id: user.id,
      provider: 'discord',
      provider_user_id: `discord-${user.id}`,
      provider_email: 'trusted@example.com',
      provider_email_verified: true,
      last_login_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    })

    const response = await client
      .put('/profile')
      .json({
        displayName: user.displayName,
        email: 'trusted@example.com',
        currentPassword: 'password123',
        phone: user.phone,
        iban: user.iban,
        showAllProducts: user.showAllProducts,
        sendMailOnPurchase: user.sendMailOnPurchase,
        sendDailyReport: user.sendDailyReport,
        colorMode: user.colorMode,
        keypadDisabled: user.keypadDisabled,
        excludedAllergenIds: [],
      })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    await user.refresh()
    assert.equal(user.email, 'trusted@example.com')
    assert.isNull(user.pendingEmail)
    assert.isNotNull(user.emailVerifiedAt)
  })

  test('IBAN change confirmation link applies pending IBAN', async ({ client, assert }) => {
    const user = await UserFactory.merge({ iban: 'CZ6508000000192000145399' }).create()
    user.pendingIban = 'CZ6508000000192000145400'
    await user.save()

    const ibans = new IbanChangeService()
    const payload = await ibans.createToken(user, user.pendingIban)
    const token = payload.verificationUrl.split('/').pop()!

    const response = await client.get(`/profile/iban/verify/${token}`).loginAs(user).redirects(0)
    response.assertStatus(302)
    response.assertHeader('location', '/profile')

    await user.refresh()
    assert.equal(user.iban, 'CZ6508000000192000145400')
    assert.isNull(user.pendingIban)
    assert.isNotNull(user.ibanVerifiedAt)
  })
})
