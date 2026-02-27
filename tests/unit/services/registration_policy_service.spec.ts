import '#tests/test_context'
import { test } from '@japa/runner'
import RegistrationPolicyService from '#services/registration_policy_service'

test.group('RegistrationPolicyService', () => {
  test('open mode allows self-registration', async ({ assert }) => {
    const service = new RegistrationPolicyService({ mode: 'open' })
    const decision = service.canSelfRegister({ provider: 'oidc', email: 'user@example.com' })

    assert.deepEqual(decision, { allowed: true, reason: 'allowed' })
  })

  test('closed mode blocks self-registration', async ({ assert }) => {
    const service = new RegistrationPolicyService({ mode: 'closed' })
    const decision = service.canSelfRegister({ provider: 'oidc', email: 'user@example.com' })

    assert.deepEqual(decision, { allowed: false, reason: 'mode_closed' })
  })

  test('invite_only mode blocks self-registration', async ({ assert }) => {
    const service = new RegistrationPolicyService({ mode: 'invite_only' })
    const decision = service.canSelfRegister({ provider: 'local', email: 'user@example.com' })

    assert.deepEqual(decision, { allowed: false, reason: 'invite_required' })
  })

  test('domain_auto_approve allows email in allowed domains', async ({ assert }) => {
    const service = new RegistrationPolicyService({
      mode: 'domain_auto_approve',
      allowedDomains: ['example.com', 'company.local'],
    })
    const decision = service.canSelfRegister({ provider: 'oidc', email: 'user@company.local' })

    assert.deepEqual(decision, { allowed: true, reason: 'allowed' })
  })

  test('domain_auto_approve rejects email outside allowed domains', async ({ assert }) => {
    const service = new RegistrationPolicyService({
      mode: 'domain_auto_approve',
      allowedDomains: ['example.com'],
    })
    const decision = service.canSelfRegister({ provider: 'social', email: 'user@other.com' })

    assert.deepEqual(decision, { allowed: false, reason: 'domain_not_allowed' })
  })

  test('domain_auto_approve requires email', async ({ assert }) => {
    const service = new RegistrationPolicyService({
      mode: 'domain_auto_approve',
      allowedDomains: ['example.com'],
    })
    const decision = service.canSelfRegister({ provider: 'oidc', email: null })

    assert.deepEqual(decision, { allowed: false, reason: 'missing_email' })
  })

  test('getAllowedDomains returns normalized list', async ({ assert }) => {
    const service = new RegistrationPolicyService({
      mode: 'domain_auto_approve',
      allowedDomains: [' Example.com ', 'Second.local'],
    })

    assert.deepEqual(service.getAllowedDomains(), ['example.com', 'second.local'])
  })
})
