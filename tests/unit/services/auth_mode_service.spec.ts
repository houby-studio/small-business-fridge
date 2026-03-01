import '#tests/test_context'
import { test } from '@japa/runner'
import AuthModeService from '#services/auth_mode_service'

test.group('AuthModeService', (group) => {
  const previousEnv = {
    AUTH_PROVIDERS: process.env.AUTH_PROVIDERS,
    AUTH_AUTO_REGISTER_PROVIDERS: process.env.AUTH_AUTO_REGISTER_PROVIDERS,
  }

  group.each.setup(() => {
    process.env.AUTH_PROVIDERS = 'local'
    process.env.AUTH_AUTO_REGISTER_PROVIDERS = ''
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

  test('AUTH_PROVIDERS=local keeps local login only', async ({ assert }) => {
    process.env.AUTH_PROVIDERS = 'local'

    const service = new AuthModeService()
    assert.isFalse(service.isOidcEnabled())
    assert.isFalse(service.isLocalLoginDisabled())
    assert.isFalse(service.isOidcOnlyMode())
  })

  test('AUTH_PROVIDERS=microsoft enables provider-only mode', async ({ assert }) => {
    process.env.AUTH_PROVIDERS = 'microsoft'

    const service = new AuthModeService()
    assert.isTrue(service.isOidcEnabled())
    assert.isTrue(service.isLocalLoginDisabled())
    assert.isTrue(service.isOidcOnlyMode())
    assert.deepEqual(service.getEnabledExternalProviders(), ['microsoft'])
  })

  test('AUTH_PROVIDERS with local and multiple external providers enables hybrid mode', async ({
    assert,
  }) => {
    process.env.AUTH_PROVIDERS = 'local,microsoft,discord'
    const service = new AuthModeService()
    assert.isTrue(service.isOidcEnabled())
    assert.isFalse(service.isLocalLoginDisabled())
    assert.deepEqual(service.getEnabledExternalProviders(), ['microsoft', 'discord'])
  })

  test('AUTH_AUTO_REGISTER_PROVIDERS controls provider auto registration', async ({ assert }) => {
    process.env.AUTH_AUTO_REGISTER_PROVIDERS = 'microsoft,discord'

    const service = new AuthModeService()
    assert.isTrue(service.isOidcAutoRegisterEnabled())
    assert.isTrue(service.isProviderAutoRegisterEnabled('discord'))

    process.env.AUTH_AUTO_REGISTER_PROVIDERS = 'discord'
    assert.isFalse(new AuthModeService().isOidcAutoRegisterEnabled())
    assert.isTrue(new AuthModeService().isProviderAutoRegisterEnabled('discord'))
  })
})
