import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { UserFactory } from '#database/factories/user_factory'
import InvitationService from '#services/invitation_service'

test.group('Web Auth - Environment Modes', (group) => {
  const previousEnv = {
    OIDC_ENABLED: process.env.OIDC_ENABLED,
    LOCAL_LOGIN_DISABLED: process.env.LOCAL_LOGIN_DISABLED,
    OIDC_AUTO_REGISTER: process.env.OIDC_AUTO_REGISTER,
    REGISTRATION_MODE: process.env.REGISTRATION_MODE,
    REGISTRATION_ALLOWED_DOMAINS: process.env.REGISTRATION_ALLOWED_DOMAINS,
  }

  group.each.setup(async () => {
    await db.from('remember_me_tokens').delete()
    await db.from('password_reset_tokens').delete()
    await db.from('user_invitations').delete()
    await db.from('users').delete()

    process.env.OIDC_ENABLED = 'false'
    process.env.LOCAL_LOGIN_DISABLED = 'false'
    process.env.OIDC_AUTO_REGISTER = 'false'
    process.env.REGISTRATION_MODE = 'open'
    process.env.REGISTRATION_ALLOWED_DOMAINS = ''
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

  test('misconfigured local-disabled without OIDC keeps local login available', async ({
    client,
    assert,
  }) => {
    process.env.OIDC_ENABLED = 'false'
    process.env.LOCAL_LOGIN_DISABLED = 'true'

    await UserFactory.apply('admin').create()
    await User.create({
      username: 'local-user',
      password: 'secret123',
      displayName: 'Local User',
      email: 'local-user@example.com',
      keypadId: 9040,
      role: 'customer',
    })

    const showResponse = await client.get('/login')
    showResponse.assertStatus(200)

    const loginResponse = await client
      .post('/login')
      .form({ username: 'local-user', password: 'secret123' })
      .withCsrfToken()
      .redirects(0)
    loginResponse.assertStatus(302)
    loginResponse.assertHeader('location', '/shop')

    assert.notInclude(showResponse.text(), '/auth/oidc/redirect')
  })

  test('OIDC-only mode redirects login to OIDC provider', async ({ client }) => {
    process.env.OIDC_ENABLED = 'true'
    process.env.LOCAL_LOGIN_DISABLED = 'true'

    await UserFactory.apply('admin').create()

    const response = await client.get('/login').redirects(0)
    response.assertStatus(302)
    response.assertHeader('location', '/auth/oidc/redirect')
  })

  test('OIDC-only mode blocks local registration and password reset pages', async ({
    client,
    assert,
  }) => {
    process.env.OIDC_ENABLED = 'true'
    process.env.LOCAL_LOGIN_DISABLED = 'true'

    await UserFactory.apply('admin').create()

    const registerResponse = await client.get('/register').redirects(0)
    registerResponse.assertStatus(302)
    registerResponse.assertHeader('location', '/login')

    const forgotResponse = await client.get('/forgot-password').redirects(0)
    forgotResponse.assertStatus(302)
    forgotResponse.assertHeader('location', '/login')

    const service = new InvitationService()
    const { inviteUrl } = await service.createInvite({
      email: 'invite-only-oidc@example.com',
      role: 'customer',
      invitedByUserId: null,
    })
    const token = inviteUrl.split('/').pop()!
    const inviteResponse = await client.get(`/register/invite/${token}`).redirects(0)
    inviteResponse.assertStatus(302)
    inviteResponse.assertHeader('location', '/login')

    assert.notInclude(inviteResponse.text(), 'Complete Your Account Setup')
  })

  test('both login methods enabled keeps local login and OIDC redirect active', async ({
    client,
    assert,
  }) => {
    process.env.OIDC_ENABLED = 'true'
    process.env.LOCAL_LOGIN_DISABLED = 'false'
    process.env.REGISTRATION_MODE = 'open'

    await UserFactory.apply('admin').create()

    const response = await client.get('/login')
    response.assertStatus(200)

    const oidcResponse = await client.get('/auth/oidc/redirect').redirects(0)
    oidcResponse.assertStatus(302)
    assert.include(oidcResponse.header('location') ?? '', 'login.microsoftonline.com')
  })

  test('local-only mode hides OIDC button', async ({ client, assert }) => {
    process.env.OIDC_ENABLED = 'false'
    process.env.LOCAL_LOGIN_DISABLED = 'false'
    process.env.REGISTRATION_MODE = 'open'

    await UserFactory.apply('admin').create()

    const response = await client.get('/login')
    response.assertStatus(200)
    assert.notInclude(response.text(), '/auth/oidc/redirect')
  })

  test('local registration respects invite_only and closed modes', async ({ client, assert }) => {
    await UserFactory.apply('admin').create()

    process.env.REGISTRATION_MODE = 'invite_only'
    const inviteOnly = await client
      .post('/register')
      .form({
        displayName: 'Invite Blocked',
        email: 'invite-blocked@example.com',
        username: 'invite-blocked',
        password: 'secret12345',
        passwordConfirmation: 'secret12345',
      })
      .withCsrfToken()
      .redirects(0)
    inviteOnly.assertStatus(302)
    inviteOnly.assertHeader('location', '/login')
    assert.isNull(await User.findBy('username', 'invite-blocked'))

    process.env.REGISTRATION_MODE = 'closed'
    const closed = await client
      .post('/register')
      .form({
        displayName: 'Closed Blocked',
        email: 'closed-blocked@example.com',
        username: 'closed-blocked',
        password: 'secret12345',
        passwordConfirmation: 'secret12345',
      })
      .withCsrfToken()
      .redirects(0)
    closed.assertStatus(302)
    closed.assertHeader('location', '/login')
    assert.isNull(await User.findBy('username', 'closed-blocked'))
  })

  test('domain_auto_approve allows only configured domains for local registration', async ({
    client,
    assert,
  }) => {
    await UserFactory.apply('admin').create()
    process.env.REGISTRATION_MODE = 'domain_auto_approve'
    process.env.REGISTRATION_ALLOWED_DOMAINS = 'allowed.test'

    const denied = await client
      .post('/register')
      .form({
        displayName: 'Denied Domain',
        email: 'denied@example.com',
        username: 'denied-domain',
        password: 'secret12345',
        passwordConfirmation: 'secret12345',
      })
      .withCsrfToken()
      .redirects(0)
    denied.assertStatus(302)
    denied.assertHeader('location', '/login')
    assert.isNull(await User.findBy('username', 'denied-domain'))

    const allowed = await client
      .post('/register')
      .form({
        displayName: 'Allowed Domain',
        email: 'allowed@allowed.test',
        username: 'allowed-domain',
        password: 'secret12345',
        passwordConfirmation: 'secret12345',
      })
      .withCsrfToken()
      .redirects(0)
    allowed.assertStatus(302)
    allowed.assertHeader('location', '/shop')
    assert.exists(await User.findBy('username', 'allowed-domain'))
  })
})
