import '#tests/test_context'
import { test } from '@japa/runner'
import RegistrationPolicyService from '#services/registration_policy_service'

test.group('RegistrationPolicyService', (group) => {
  group.each.teardown(() => {
    delete process.env.REGISTRATION_MODE
    delete process.env.REGISTRATION_ALLOWED_DOMAINS
  })

  test('open mode allows self-registration', async ({ assert }) => {
    process.env.REGISTRATION_MODE = 'open'
    process.env.REGISTRATION_ALLOWED_DOMAINS = ''

    const service = new RegistrationPolicyService()
    const decision = service.canSelfRegister({ provider: 'oidc', email: 'user@example.com' })

    assert.deepEqual(decision, { allowed: true, reason: 'allowed' })
  })

  test('closed mode blocks self-registration', async ({ assert }) => {
    process.env.REGISTRATION_MODE = 'closed'
    process.env.REGISTRATION_ALLOWED_DOMAINS = ''

    const service = new RegistrationPolicyService()
    const decision = service.canSelfRegister({ provider: 'oidc', email: 'user@example.com' })

    assert.deepEqual(decision, { allowed: false, reason: 'mode_closed' })
  })

  test('invite_only mode blocks self-registration', async ({ assert }) => {
    process.env.REGISTRATION_MODE = 'invite_only'
    process.env.REGISTRATION_ALLOWED_DOMAINS = ''

    const service = new RegistrationPolicyService()
    const decision = service.canSelfRegister({ provider: 'local', email: 'user@example.com' })

    assert.deepEqual(decision, { allowed: false, reason: 'invite_required' })
  })

  test('domain_auto_approve allows email in allowed domains', async ({ assert }) => {
    process.env.REGISTRATION_MODE = 'domain_auto_approve'
    process.env.REGISTRATION_ALLOWED_DOMAINS = 'example.com, company.local'

    const service = new RegistrationPolicyService()
    const decision = service.canSelfRegister({ provider: 'oidc', email: 'user@company.local' })

    assert.deepEqual(decision, { allowed: true, reason: 'allowed' })
  })

  test('domain_auto_approve rejects email outside allowed domains', async ({ assert }) => {
    process.env.REGISTRATION_MODE = 'domain_auto_approve'
    process.env.REGISTRATION_ALLOWED_DOMAINS = 'example.com'

    const service = new RegistrationPolicyService()
    const decision = service.canSelfRegister({ provider: 'social', email: 'user@other.com' })

    assert.deepEqual(decision, { allowed: false, reason: 'domain_not_allowed' })
  })

  test('domain_auto_approve requires email', async ({ assert }) => {
    process.env.REGISTRATION_MODE = 'domain_auto_approve'
    process.env.REGISTRATION_ALLOWED_DOMAINS = 'example.com'

    const service = new RegistrationPolicyService()
    const decision = service.canSelfRegister({ provider: 'oidc', email: null })

    assert.deepEqual(decision, { allowed: false, reason: 'missing_email' })
  })
})
