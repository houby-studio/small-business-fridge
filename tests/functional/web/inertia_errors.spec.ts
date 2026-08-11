import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { CategoryFactory } from '#database/factories/category_factory'

const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('users').delete()
}

test.group('Inertia shares validation errors', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a rejected form comes back with props.errors so the client can show them', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    await CategoryFactory.create()

    const response = await client
      .post('/supplier/products')
      .header('x-inertia', 'true')
      .header('x-inertia-version', '1')
      .header('referer', '/supplier/products/new')
      .fields({ displayName: '', description: '', categoryId: '' })
      .loginAs(supplier)
      .withCsrfToken()
      .redirects(1)

    response.assertStatus(200)
    const props = response.body().props
    assert.property(props, 'errors')
    assert.property(props.errors, 'displayName')
  })
})
