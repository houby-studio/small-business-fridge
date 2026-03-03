import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { UserFactory } from '#database/factories/user_factory'
import InvitationService from '#services/invitation_service'

type ProviderCase = {
  label: string
  providers: string
  localEnabled: boolean
  externalProviders: Array<'microsoft' | 'discord'>
}

const providerCases: ProviderCase[] = [
  {
    label: 'local only',
    providers: 'local',
    localEnabled: true,
    externalProviders: [],
  },
  {
    label: 'microsoft only',
    providers: 'microsoft',
    localEnabled: false,
    externalProviders: ['microsoft'],
  },
  {
    label: 'discord only',
    providers: 'discord',
    localEnabled: false,
    externalProviders: ['discord'],
  },
  {
    label: 'microsoft+discord only',
    providers: 'microsoft,discord',
    localEnabled: false,
    externalProviders: ['microsoft', 'discord'],
  },
  {
    label: 'local+microsoft',
    providers: 'local,microsoft',
    localEnabled: true,
    externalProviders: ['microsoft'],
  },
  {
    label: 'local+discord',
    providers: 'local,discord',
    localEnabled: true,
    externalProviders: ['discord'],
  },
  {
    label: 'local+microsoft+discord',
    providers: 'local,microsoft,discord',
    localEnabled: true,
    externalProviders: ['microsoft', 'discord'],
  },
]

test.group('Web Auth - Provider/Registration Matrix', (group) => {
  const previousEnv = {
    AUTH_PROVIDERS: process.env.AUTH_PROVIDERS,
    AUTH_AUTO_REGISTER_PROVIDERS: process.env.AUTH_AUTO_REGISTER_PROVIDERS,
    AUTH_REGISTRATION_MODE: process.env.AUTH_REGISTRATION_MODE,
    AUTH_REGISTRATION_ALLOWED_DOMAINS: process.env.AUTH_REGISTRATION_ALLOWED_DOMAINS,
    SENSITIVE_ACTION_REAUTH_TTL_MINUTES: process.env.SENSITIVE_ACTION_REAUTH_TTL_MINUTES,
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
    process.env.SENSITIVE_ACTION_REAUTH_TTL_MINUTES = '10'
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

  for (const entry of providerCases) {
    test(`bootstrap page exposes expected providers for ${entry.label}`, async ({
      client,
      assert,
    }) => {
      process.env.AUTH_PROVIDERS = entry.providers

      const response = await client
        .get('/setup/bootstrap')
        .header('X-Inertia', 'true')
        .header('X-Inertia-Version', '1')
      response.assertStatus(200)
      assert.equal(response.body().component, 'auth/bootstrap')
      assert.equal(response.body().props.localEnabled, entry.localEnabled)
      assert.deepEqual(response.body().props.externalProviders, entry.externalProviders)
    })

    test(`/login behavior matches ${entry.label}`, async ({ client, assert }) => {
      process.env.AUTH_PROVIDERS = entry.providers
      await UserFactory.apply('admin').create()

      if (!entry.localEnabled && entry.externalProviders.length === 1) {
        const response = await client.get('/login').redirects(0)
        response.assertStatus(302)
        response.assertHeader('location', `/auth/${entry.externalProviders[0]}/redirect`)
        return
      }

      const response = await client
        .get('/login')
        .header('X-Inertia', 'true')
        .header('X-Inertia-Version', '1')
      response.assertStatus(200)
      assert.equal(response.body().component, 'auth/login')
      assert.equal(response.body().props.localEnabled, entry.localEnabled)
      assert.deepEqual(response.body().props.externalProviders, entry.externalProviders)
      assert.equal(response.body().props.allowLocalRegistration, true)
    })

    test(`/profile provider-link options match ${entry.label}`, async ({ client, assert }) => {
      process.env.AUTH_PROVIDERS = entry.providers
      const user = await UserFactory.create()

      const response = await client
        .get('/profile')
        .loginAs(user)
        .header('X-Inertia', 'true')
        .header('X-Inertia-Version', '1')
      response.assertStatus(200)
      assert.equal(response.body().component, 'profile/show')
      assert.deepEqual(response.body().props.externalProviders, entry.externalProviders)
      assert.deepEqual(response.body().props.linkedProviders, [])
    })

    test(`register and forgot-password page access matches ${entry.label}`, async ({
      client,
      assert,
    }) => {
      process.env.AUTH_PROVIDERS = entry.providers
      await UserFactory.apply('admin').create()

      const registerResponse = await client
        .get('/register')
        .header('X-Inertia', 'true')
        .header('X-Inertia-Version', '1')
        .redirects(0)
      const forgotResponse = await client
        .get('/forgot-password')
        .header('X-Inertia', 'true')
        .header('X-Inertia-Version', '1')
        .redirects(0)

      if (entry.localEnabled) {
        registerResponse.assertStatus(200)
        forgotResponse.assertStatus(200)
        assert.equal(registerResponse.body().component, 'auth/register')
        assert.equal(forgotResponse.body().component, 'auth/forgot_password')
      } else {
        registerResponse.assertStatus(302)
        registerResponse.assertHeader('location', '/login')
        forgotResponse.assertStatus(302)
        forgotResponse.assertHeader('location', '/login')
      }
    })

    test(`invite page behavior matches ${entry.label}`, async ({ client, assert }) => {
      process.env.AUTH_PROVIDERS = entry.providers
      await UserFactory.apply('admin').create()

      const service = new InvitationService()
      const { inviteUrl } = await service.createInvite({
        email: `invite-${entry.label.replace(/[^a-z0-9]/gi, '-').toLowerCase()}@example.com`,
        role: 'customer',
        invitedByUserId: null,
      })
      const token = inviteUrl.split('/').pop()!

      const invitePath = `/register/invite/${token}`

      if (!entry.localEnabled && entry.externalProviders.length === 1) {
        const response = await client.get(invitePath).redirects(0)
        response.assertStatus(302)
        response.assertHeader(
          'location',
          `/auth/${entry.externalProviders[0]}/redirect?intent=invite&token=${encodeURIComponent(token)}`
        )
        return
      }

      const response = await client
        .get(invitePath)
        .header('X-Inertia', 'true')
        .header('X-Inertia-Version', '1')
      response.assertStatus(200)
      assert.equal(response.body().component, 'auth/invite')
      assert.equal(response.body().props.localEnabled, entry.localEnabled)
      assert.deepEqual(response.body().props.externalProviders, entry.externalProviders)
      assert.equal(response.body().props.token, token)
    })
  }

  test('single-provider mode keeps /login rendered after flash alert redirect', async ({
    client,
    assert,
  }) => {
    process.env.AUTH_PROVIDERS = 'microsoft'
    await UserFactory.apply('admin').create()

    const response = await client
      .get('/register/invite/not-a-real-token')
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')
      .redirects(1)
    response.assertStatus(200)
    assert.equal(response.body().component, 'auth/login')
    assert.equal(response.body().props.localEnabled, false)
    assert.deepEqual(response.body().props.externalProviders, ['microsoft'])
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

  test('provider link intent accepts one-time stepup grant when TTL is zero', async ({
    client,
    assert,
  }) => {
    process.env.AUTH_PROVIDERS = 'local,microsoft'
    process.env.SENSITIVE_ACTION_REAUTH_TTL_MINUTES = '0'
    const user = await UserFactory.create()

    const response = await client
      .get(`/auth/microsoft/redirect?intent=link&userId=${user.id}`)
      .loginAs(user)
      .withSession({
        __oidc_link_stepup_grant: {
          userId: user.id,
          provider: 'microsoft',
          issuedAt: new Date().toISOString(),
        },
      })
      .redirects(0)

    response.assertStatus(302)
    assert.include(response.header('location') ?? '', 'login.microsoftonline.com')
  })

  test('login page hides Create account link in invite_only mode', async ({ client, assert }) => {
    process.env.AUTH_PROVIDERS = 'local,microsoft'
    process.env.AUTH_REGISTRATION_MODE = 'invite_only'
    await UserFactory.apply('admin').create()

    const response = await client
      .get('/login')
      .header('X-Inertia', 'true')
      .header('X-Inertia-Version', '1')
    response.assertStatus(200)
    assert.equal(response.body().props.allowLocalRegistration, false)
    assert.equal(response.body().props.localEnabled, true)
    assert.deepEqual(response.body().props.externalProviders, ['microsoft'])
  })

  test('local registration respects open/invite_only/domain_auto_approve policy', async ({
    client,
    assert,
  }) => {
    process.env.AUTH_PROVIDERS = 'local'
    await UserFactory.apply('admin').create()

    process.env.AUTH_REGISTRATION_MODE = 'open'
    const openResponse = await client
      .post('/register')
      .form({
        displayName: 'Open Allowed',
        email: 'open-allowed@example.com',
        password: 'secret12345',
        passwordConfirmation: 'secret12345',
      })
      .withCsrfToken()
      .redirects(0)
    openResponse.assertStatus(302)
    openResponse.assertHeader('location', '/shop')
    assert.exists(await User.findBy('email', 'open-allowed@example.com'))

    await db.from('remember_me_tokens').delete()

    process.env.AUTH_REGISTRATION_MODE = 'invite_only'
    const inviteOnlyResponse = await client
      .post('/register')
      .form({
        displayName: 'Invite Blocked',
        email: 'invite-blocked@example.com',
        password: 'secret12345',
        passwordConfirmation: 'secret12345',
      })
      .withCsrfToken()
      .redirects(0)
    inviteOnlyResponse.assertStatus(302)
    inviteOnlyResponse.assertHeader('location', '/login')
    assert.isNull(await User.findBy('email', 'invite-blocked@example.com'))

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
