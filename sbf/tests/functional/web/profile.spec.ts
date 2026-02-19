import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('user_favorites').delete()
  await db.from('auth_access_tokens').delete()
  await db.from('users').delete()
}

test.group('Web Profile - color mode toggle', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('POST /profile/color-mode saves dark mode and redirects', async ({ client, assert }) => {
    const user = await UserFactory.merge({ colorMode: 'light' }).create()

    const response = await client
      .post('/profile/color-mode')
      .json({ colorMode: 'dark' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const updated = await User.findOrFail(user.id)
    assert.equal(updated.colorMode, 'dark')
  })

  test('POST /profile/color-mode saves light mode and redirects', async ({ client, assert }) => {
    const user = await UserFactory.merge({ colorMode: 'dark' }).create()

    const response = await client
      .post('/profile/color-mode')
      .json({ colorMode: 'light' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const updated = await User.findOrFail(user.id)
    assert.equal(updated.colorMode, 'light')
  })

  test('POST /profile/color-mode rejects invalid value and does not update', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.merge({ colorMode: 'light' }).create()

    const response = await client
      .post('/profile/color-mode')
      .json({ colorMode: 'auto' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    // Inertia validation failure redirects back
    response.assertStatus(302)

    // colorMode should not have changed
    const updated = await User.findOrFail(user.id)
    assert.equal(updated.colorMode, 'light')
  })

  test('POST /profile/color-mode requires authentication', async ({ client }) => {
    const response = await client
      .post('/profile/color-mode')
      .json({ colorMode: 'dark' })
      .redirects(0)

    response.assertStatus(302)
  })
})
