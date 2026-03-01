import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import BootstrapController from '#controllers/web/bootstrap_controller'
import User from '#models/user'

test.group('BootstrapController.show', (group) => {
  const previousAuthProviders = process.env.AUTH_PROVIDERS

  group.each.setup(async () => {
    await db.rawQuery(
      'TRUNCATE TABLE user_auth_identities, user_invitations, password_reset_tokens, orders, deliveries, invoices, products, categories, users RESTART IDENTITY CASCADE'
    )
    process.env.AUTH_PROVIDERS = 'local'
  })

  group.teardown(() => {
    if (previousAuthProviders === undefined) {
      delete process.env.AUTH_PROVIDERS
    } else {
      process.env.AUTH_PROVIDERS = previousAuthProviders
    }
  })

  test('returns bootstrap page props with external provider list when provider is enabled', async ({
    assert,
  }) => {
    process.env.AUTH_PROVIDERS = 'local,microsoft'

    const controller = new BootstrapController()
    const result = await controller.show({
      inertia: {
        render: (component: string, props: unknown) => ({ component, props }),
      },
      response: {
        redirect: (path: string) => ({ redirectTo: path }),
      },
    } as any)

    assert.deepEqual(result, {
      component: 'auth/bootstrap',
      props: { externalProviders: ['microsoft'] },
    })
  })

  test('returns bootstrap page props with empty provider list when local only', async ({
    assert,
  }) => {
    process.env.AUTH_PROVIDERS = 'local'

    const controller = new BootstrapController()
    const result = await controller.show({
      inertia: {
        render: (component: string, props: unknown) => ({ component, props }),
      },
      response: {
        redirect: (path: string) => ({ redirectTo: path }),
      },
    } as any)

    assert.deepEqual(result, {
      component: 'auth/bootstrap',
      props: { externalProviders: [] },
    })
  })

  test('redirects to login when an admin already exists', async ({ assert }) => {
    await User.create({
      password: 'secret123',
      displayName: 'Existing Admin',
      email: 'existing-admin@localhost',
      keypadId: 9989,
      role: 'admin',
    })

    const controller = new BootstrapController()
    const result = await controller.show({
      inertia: {
        render: (component: string, props: unknown) => ({ component, props }),
      },
      response: {
        redirect: (path: string) => ({ redirectTo: path }),
      },
    } as any)

    assert.deepEqual(result, { redirectTo: '/login' })
  })
})
