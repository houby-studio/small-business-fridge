import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { UserFactory } from '#database/factories/user_factory'
import InvitationService from '#services/invitation_service'

test.group('Web Auth - Provider Modes', (group) => {
  const previousEnv = {
    AUTH_PROVIDERS: process.env.AUTH_PROVIDERS,
    AUTH_AUTO_REGISTER_PROVIDERS: process.env.AUTH_AUTO_REGISTER_PROVIDERS,
    AUTH_REGISTRATION_MODE: process.env.AUTH_REGISTRATION_MODE,
    AUTH_REGISTRATION_ALLOWED_DOMAINS: process.env.AUTH_REGISTRATION_ALLOWED_DOMAINS,
  }

  group.each.setup(async () => {
    await db.from('remember_me_tokens').delete()
    await db.from('password_reset_tokens').delete()
    await db.from('user_invitations').delete()
    await db.from('user_auth_identities').delete()
    await db.from('users').delete()

    process.env.AUTH_PROVIDERS = 'local'
    process.env.AUTH_AUTO_REGISTER_PROVIDERS = ''
    process.env.AUTH_REGISTRATION_MODE = 'open'
    process.env.AUTH_REGISTRATION_ALLOWED_DOMAINS = ''
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

  test('provider-only mode redirects /login directly to provider', async ({ client }) => {
    process.env.AUTH_PROVIDERS = 'microsoft'

    await UserFactory.apply('admin').create()

    const response = await client.get('/login').redirects(0)
    response.assertStatus(302)
    response.assertHeader('location', '/auth/microsoft/redirect')
  })

  test('multiple external providers show login form instead of auto-redirecting', async ({
    client,
    assert,
  }) => {
    process.env.AUTH_PROVIDERS = 'microsoft,discord'

    await UserFactory.apply('admin').create()

    const response = await client.get('/login').redirects(0)
    response.assertStatus(200)
    // Inertia embeds provider names in data-page JSON (double-quotes are HTML-encoded)
    assert.include(response.text(), 'microsoft')
    assert.include(response.text(), 'discord')
  })

  test('provider-only mode blocks local registration and password reset pages', async ({
    client,
    assert,
  }) => {
    process.env.AUTH_PROVIDERS = 'microsoft'

    await UserFactory.apply('admin').create()

    const registerResponse = await client.get('/register').redirects(0)
    registerResponse.assertStatus(302)
    registerResponse.assertHeader('location', '/login')

    const forgotResponse = await client.get('/forgot-password').redirects(0)
    forgotResponse.assertStatus(302)
    forgotResponse.assertHeader('location', '/login')

    const service = new InvitationService()
    const { inviteUrl } = await service.createInvite({
      email: 'invite-only-provider@example.com',
      role: 'customer',
      invitedByUserId: null,
    })
    const token = inviteUrl.split('/').pop()!
    const inviteResponse = await client.get(`/register/invite/${token}`).redirects(0)
    inviteResponse.assertStatus(302)
    inviteResponse.assertHeader('location', '/login')

    assert.notInclude(inviteResponse.text(), 'Complete Your Account Setup')
  })

  test('hybrid mode keeps local login and microsoft redirect active', async ({
    client,
    assert,
  }) => {
    process.env.AUTH_PROVIDERS = 'local,microsoft'

    await UserFactory.apply('admin').create()

    const response = await client.get('/login')
    response.assertStatus(200)

    const oauthResponse = await client.get('/auth/microsoft/redirect').redirects(0)
    oauthResponse.assertStatus(302)
    assert.include(oauthResponse.header('location') ?? '', 'login.microsoftonline.com')
  })

  test('provider invite intent rejects invalid invite token before provider redirect', async ({
    client,
  }) => {
    process.env.AUTH_PROVIDERS = 'local,microsoft'

    await UserFactory.apply('admin').create()

    const response = await client
      .get('/auth/microsoft/redirect?intent=invite&token=bad-token')
      .redirects(0)
    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('provider invite intent with valid token proceeds to provider redirect', async ({
    client,
    assert,
  }) => {
    process.env.AUTH_PROVIDERS = 'local,microsoft'

    await UserFactory.apply('admin').create()

    const invitationService = new InvitationService()
    const { inviteUrl } = await invitationService.createInvite({
      email: 'invite-intent-valid@example.com',
      role: 'customer',
      invitedByUserId: null,
    })
    const token = inviteUrl.split('/').pop()!

    const response = await client
      .get(`/auth/microsoft/redirect?intent=invite&token=${encodeURIComponent(token)}`)
      .redirects(0)
    response.assertStatus(302)
    assert.include(response.header('location') ?? '', 'login.microsoftonline.com')
  })

  test('local-only mode hides provider button', async ({ client, assert }) => {
    process.env.AUTH_PROVIDERS = 'local'
    process.env.AUTH_REGISTRATION_MODE = 'open'

    await UserFactory.apply('admin').create()

    const response = await client.get('/login')
    response.assertStatus(200)
    assert.notInclude(response.text(), '/auth/microsoft/redirect')
  })

  test('local registration respects invite_only mode', async ({ client, assert }) => {
    await UserFactory.apply('admin').create()

    process.env.AUTH_REGISTRATION_MODE = 'invite_only'
    const inviteOnly = await client
      .post('/register')
      .form({
        displayName: 'Invite Blocked',
        email: 'invite-blocked@example.com',
        password: 'secret12345',
        passwordConfirmation: 'secret12345',
      })
      .withCsrfToken()
      .redirects(0)
    inviteOnly.assertStatus(302)
    inviteOnly.assertHeader('location', '/login')
    assert.isNull(await User.findBy('email', 'invite-blocked@example.com'))
  })

  test('domain_auto_approve allows only configured domains for local registration', async ({
    client,
    assert,
  }) => {
    await UserFactory.apply('admin').create()
    process.env.AUTH_REGISTRATION_MODE = 'domain_auto_approve'
    process.env.AUTH_REGISTRATION_ALLOWED_DOMAINS = 'allowed.test'

    const denied = await client
      .post('/register')
      .form({
        displayName: 'Denied Domain',
        email: 'denied@example.com',
        password: 'secret12345',
        passwordConfirmation: 'secret12345',
      })
      .withCsrfToken()
      .redirects(0)
    denied.assertStatus(302)
    denied.assertHeader('location', '/login')
    assert.isNull(await User.findBy('email', 'denied@example.com'))

    const allowed = await client
      .post('/register')
      .form({
        displayName: 'Allowed Domain',
        email: 'allowed@allowed.test',
        password: 'secret12345',
        passwordConfirmation: 'secret12345',
      })
      .withCsrfToken()
      .redirects(0)
    allowed.assertStatus(302)
    allowed.assertHeader('location', '/shop')
    assert.exists(await User.findBy('email', 'allowed@allowed.test'))
  })
})
