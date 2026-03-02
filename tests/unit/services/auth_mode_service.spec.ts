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

  test('resolves all canonical AUTH_PROVIDERS combinations', async ({ assert }) => {
    const combos = [
      {
        raw: 'local',
        localEnabled: true,
        external: [] as Array<'microsoft' | 'discord'>,
      },
      {
        raw: 'microsoft',
        localEnabled: false,
        external: ['microsoft'] as Array<'microsoft' | 'discord'>,
      },
      {
        raw: 'discord',
        localEnabled: false,
        external: ['discord'] as Array<'microsoft' | 'discord'>,
      },
      {
        raw: 'microsoft,discord',
        localEnabled: false,
        external: ['microsoft', 'discord'] as Array<'microsoft' | 'discord'>,
      },
      {
        raw: 'local,microsoft',
        localEnabled: true,
        external: ['microsoft'] as Array<'microsoft' | 'discord'>,
      },
      {
        raw: 'local,discord',
        localEnabled: true,
        external: ['discord'] as Array<'microsoft' | 'discord'>,
      },
      {
        raw: 'local,microsoft,discord',
        localEnabled: true,
        external: ['microsoft', 'discord'] as Array<'microsoft' | 'discord'>,
      },
    ]

    for (const combo of combos) {
      process.env.AUTH_PROVIDERS = combo.raw
      const service = new AuthModeService()

      assert.equal(service.isLocalEnabled(), combo.localEnabled)
      assert.equal(service.isLocalLoginDisabled(), !combo.localEnabled)
      assert.deepEqual(service.getEnabledExternalProviders(), combo.external)
      assert.equal(service.isOidcOnlyMode(), combo.external.length > 0 && !combo.localEnabled)
    }
  })

  test('normalizes provider list and falls back to local on empty/unsupported input', async ({
    assert,
  }) => {
    process.env.AUTH_PROVIDERS = ' MICROSOFT , DISCORD '
    let service = new AuthModeService()
    assert.deepEqual(service.getEnabledExternalProviders(), ['microsoft', 'discord'])
    assert.isTrue(service.isLocalLoginDisabled())

    process.env.AUTH_PROVIDERS = 'unknown-provider'
    service = new AuthModeService()
    assert.isTrue(service.isLocalEnabled())
    assert.deepEqual(service.getEnabledExternalProviders(), [])

    process.env.AUTH_PROVIDERS = ''
    service = new AuthModeService()
    assert.isTrue(service.isLocalEnabled())
    assert.deepEqual(service.getEnabledExternalProviders(), [])
  })

  test('AUTH_AUTO_REGISTER_PROVIDERS controls provider auto registration per provider', async ({
    assert,
  }) => {
    process.env.AUTH_AUTO_REGISTER_PROVIDERS = ''
    let service = new AuthModeService()
    assert.isFalse(service.isProviderAutoRegisterEnabled('microsoft'))
    assert.isFalse(service.isProviderAutoRegisterEnabled('discord'))

    process.env.AUTH_AUTO_REGISTER_PROVIDERS = 'microsoft'
    service = new AuthModeService()
    assert.isTrue(service.isProviderAutoRegisterEnabled('microsoft'))
    assert.isFalse(service.isProviderAutoRegisterEnabled('discord'))

    process.env.AUTH_AUTO_REGISTER_PROVIDERS = 'discord'
    service = new AuthModeService()
    assert.isFalse(service.isProviderAutoRegisterEnabled('microsoft'))
    assert.isTrue(service.isProviderAutoRegisterEnabled('discord'))

    process.env.AUTH_AUTO_REGISTER_PROVIDERS = 'microsoft,discord'
    service = new AuthModeService()
    assert.isTrue(service.isProviderAutoRegisterEnabled('microsoft'))
    assert.isTrue(service.isProviderAutoRegisterEnabled('discord'))
  })
})
