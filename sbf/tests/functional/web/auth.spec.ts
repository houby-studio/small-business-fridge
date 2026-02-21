import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'

test.group('Web Auth', (group) => {
  group.each.setup(async () => {
    await db.from('orders').delete()
    await db.from('deliveries').delete()
    await db.from('products').delete()
    await db.from('categories').delete()
    await db.from('users').delete()
  })

  test('login page renders for guests', async ({ client }) => {
    const response = await client.get('/login')
    response.assertStatus(200)
  })

  test('unauthenticated user is redirected from /shop', async ({ client }) => {
    const response = await client.get('/shop').redirects(0)
    response.assertStatus(302)
  })

  test('authenticated user can access /shop', async ({ client }) => {
    const user = await UserFactory.create()
    const response = await client.get('/shop').loginAs(user)
    response.assertStatus(200)
  })

  test('authenticated user can access /orders', async ({ client }) => {
    const user = await UserFactory.create()
    const response = await client.get('/orders').loginAs(user)
    response.assertStatus(200)
  })

  test('authenticated user can access /invoices', async ({ client }) => {
    const user = await UserFactory.create()
    const response = await client.get('/invoices').loginAs(user)
    response.assertStatus(200)
  })

  test('authenticated user can access /profile', async ({ client }) => {
    const user = await UserFactory.create()
    const response = await client.get('/profile').loginAs(user)
    response.assertStatus(200)
  })
})

test.group('Web Auth - Remember Me', (group) => {
  const cleanAll = async () => {
    await db.from('remember_me_tokens').delete()
    await db.from('users').delete()
  }
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('POST /login with rememberMe=true creates a remember_me_token in DB', async ({
    client,
    assert,
  }) => {
    const user = await User.create({
      username: 'remtest',
      password: 'secret123',
      displayName: 'Remember Test',
      email: 'remtest@test.local',
      keypadId: 9901,
      role: 'customer',
    })

    const response = await client
      .post('/login')
      .form({ username: 'remtest', password: 'secret123', rememberMe: true })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const tokens = await db.from('remember_me_tokens').where('tokenable_id', user.id)
    assert.lengthOf(tokens, 1)
  })

  test('POST /login without rememberMe does not create a remember_me_token', async ({
    client,
    assert,
  }) => {
    await User.create({
      username: 'noremtest',
      password: 'secret123',
      displayName: 'No Remember Test',
      email: 'noremtest@test.local',
      keypadId: 9902,
      role: 'customer',
    })

    const response = await client
      .post('/login')
      .form({ username: 'noremtest', password: 'secret123' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const tokens = await db.from('remember_me_tokens')
    assert.lengthOf(tokens, 0)
  })
})

test.group('Web Role Middleware', (group) => {
  group.each.setup(async () => {
    await db.from('orders').delete()
    await db.from('deliveries').delete()
    await db.from('products').delete()
    await db.from('categories').delete()
    await db.from('users').delete()
  })

  test('customer cannot access supplier routes', async ({ client, assert }) => {
    const customer = await UserFactory.create()
    const response = await client.get('/supplier/stock').loginAs(customer).redirects(0)
    response.assertStatus(302)
    // Redirected away (either to / or /login depending on auth state)
    assert.notEqual(response.header('location'), '/supplier/stock')
  })

  test('supplier can access supplier routes', async ({ client }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const response = await client.get('/supplier/stock').loginAs(supplier)
    response.assertStatus(200)
  })

  test('customer cannot access admin routes', async ({ client, assert }) => {
    const customer = await UserFactory.create()
    const response = await client.get('/admin/dashboard').loginAs(customer).redirects(0)
    response.assertStatus(302)
    assert.notEqual(response.header('location'), '/admin/dashboard')
  })

  test('admin can access admin routes', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const response = await client.get('/admin/dashboard').loginAs(admin)
    response.assertStatus(200)
  })

  test('admin can access supplier routes (implicit permission)', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const response = await client.get('/supplier/stock').loginAs(admin)
    response.assertStatus(200)
  })
})
