import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import PageView from '#models/page_view'
import KioskSession from '#models/kiosk_session'
import db from '@adonisjs/lucid/services/db'

const cleanAll = async () => {
  await db.from('recommendations').delete()
  await db.from('page_views').delete()
  await db.from('kiosk_sessions').delete()
  await db.from('orders').delete()
  await db.from('deliveries').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('auth_access_tokens').delete()
  await db.from('users').delete()
}

test.group('Shop tracking - page views', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('GET /shop creates a PageView row for authenticated user', async ({ client, assert }) => {
    const user = await UserFactory.create()

    await client.get('/shop').loginAs(user)

    // Give the fire-and-forget a moment to complete
    await new Promise((r) => setTimeout(r, 300))

    const count = await PageView.query().where('userId', user.id).count('* as total')
    assert.isAbove(Number(count[0].$extras.total), 0)
  })

  test('GET /shop response includes recommendations prop', async ({ client, assert }) => {
    const user = await UserFactory.create()

    const response = await client.get('/shop').loginAs(user)

    response.assertStatus(200)
    assert.include(response.text(), 'recommendations')
  })
})

test.group('Kiosk tracking - sessions', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('GET /kiosk/shop with valid keypadId creates a KioskSession row', async ({
    client,
    assert,
  }) => {
    // Kiosk routes require auth — the kiosk device is logged in as a kiosk user
    const kioskDevice = await UserFactory.apply('kiosk').create()
    const category = await CategoryFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 3,
      price: 10,
    }).create()
    const customer = await UserFactory.create()

    const response = await client
      .get(`/kiosk/shop?keypadId=${customer.keypadId}`)
      .loginAs(kioskDevice)
    response.assertStatus(200)

    // Give the fire-and-forget a moment to complete
    await new Promise((r) => setTimeout(r, 300))

    const count = await KioskSession.query().where('userId', customer.id).count('* as total')
    assert.isAbove(Number(count[0].$extras.total), 0)
  })

  test('GET /kiosk/shop with invalid keypadId does not create a KioskSession row', async ({
    client,
    assert,
  }) => {
    const kioskDevice = await UserFactory.apply('kiosk').create()

    await client.get('/kiosk/shop?keypadId=999999').loginAs(kioskDevice)

    const count = await KioskSession.query().count('* as total')
    assert.equal(Number(count[0].$extras.total), 0)
  })

  test('GET /kiosk/shop response includes recommendations prop', async ({ client, assert }) => {
    const kioskDevice = await UserFactory.apply('kiosk').create()
    const customer = await UserFactory.create()

    const response = await client
      .get(`/kiosk/shop?keypadId=${customer.keypadId}`)
      .loginAs(kioskDevice)

    response.assertStatus(200)
    assert.include(response.text(), 'recommendations')
  })
})
