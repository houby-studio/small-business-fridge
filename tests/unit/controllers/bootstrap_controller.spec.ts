import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import BootstrapController from '#controllers/web/bootstrap_controller'
import User from '#models/user'

test.group('BootstrapController.show', (group) => {
  const previousOidcEnabled = process.env.OIDC_ENABLED

  group.each.setup(async () => {
    await db.from('users').delete()
    process.env.OIDC_ENABLED = 'false'
  })

  group.teardown(() => {
    if (previousOidcEnabled === undefined) {
      delete process.env.OIDC_ENABLED
    } else {
      process.env.OIDC_ENABLED = previousOidcEnabled
    }
  })

  test('returns bootstrap page props with oidcEnabled=true when OIDC is enabled', async ({
    assert,
  }) => {
    process.env.OIDC_ENABLED = 'true'

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
      props: { oidcEnabled: true },
    })
  })

  test('returns bootstrap page props with oidcEnabled=false when OIDC is disabled', async ({
    assert,
  }) => {
    process.env.OIDC_ENABLED = 'false'

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
      props: { oidcEnabled: false },
    })
  })

  test('redirects to login when an admin already exists', async ({ assert }) => {
    await User.create({
      username: 'existing-admin',
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
