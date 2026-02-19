import { test } from '@japa/runner'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import ShopService from '#services/shop_service'
import db from '@adonisjs/lucid/services/db'

const shopService = new ShopService()

test.group('ShopService', (group) => {
  group.each.setup(async () => {
    await db.from('user_favorites').delete()
    await db.from('orders').delete()
    await db.from('deliveries').delete()
    await db.from('products').delete()
    await db.from('categories').delete()
    await db.from('users').delete()
  })

  test('getProducts returns in-stock products', async ({ assert }) => {
    const category = await CategoryFactory.create()
    const supplier = await UserFactory.apply('supplier').create()

    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 5,
      price: 10,
    }).create()

    const products = await shopService.getProducts()

    assert.lengthOf(products, 1)
    assert.equal(products[0].displayName, product.displayName)
    assert.equal(products[0].stockSum, 5)
    assert.equal(products[0].price, 10)
  })

  test('getProducts excludes out-of-stock products by default', async ({ assert }) => {
    const category = await CategoryFactory.create()
    const supplier = await UserFactory.apply('supplier').create()

    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 0,
      amountSupplied: 5,
      price: 10,
    }).create()

    const products = await shopService.getProducts()
    assert.lengthOf(products, 0)
  })

  test('getProducts includes out-of-stock when showAll is true', async ({ assert }) => {
    const category = await CategoryFactory.create()
    const supplier = await UserFactory.apply('supplier').create()

    const product = await ProductFactory.merge({ categoryId: category.id }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 0,
      amountSupplied: 5,
      price: 10,
    }).create()

    const products = await shopService.getProducts({ showAll: true })
    assert.lengthOf(products, 1)
    assert.equal(products[0].stockSum, 0)
  })

  test('getProducts excludes products from disabled categories', async ({ assert }) => {
    const disabledCategory = await CategoryFactory.apply('disabled').create()
    const supplier = await UserFactory.apply('supplier').create()

    const product = await ProductFactory.merge({ categoryId: disabledCategory.id }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 5,
      price: 10,
    }).create()

    const products = await shopService.getProducts()
    assert.lengthOf(products, 0)
  })

  test('getProducts picks cheapest delivery price', async ({ assert }) => {
    const category = await CategoryFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()

    // Two deliveries at different prices
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 3,
      price: 20,
    }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product.id,
      amountLeft: 2,
      price: 12,
    }).create()

    const products = await shopService.getProducts()

    assert.lengthOf(products, 1)
    assert.equal(products[0].stockSum, 5) // 3 + 2
    assert.equal(products[0].price, 12) // cheapest
  })

  test('getProducts marks favorites for authenticated user', async ({ assert }) => {
    const category = await CategoryFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const buyer = await UserFactory.create()

    const product1 = await ProductFactory.merge({ categoryId: category.id }).create()
    const product2 = await ProductFactory.merge({ categoryId: category.id }).create()

    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product1.id,
      amountLeft: 5,
      price: 10,
    }).create()
    await DeliveryFactory.merge({
      supplierId: supplier.id,
      productId: product2.id,
      amountLeft: 5,
      price: 10,
    }).create()

    // Mark product1 as favorite
    await db
      .table('user_favorites')
      .insert({ user_id: buyer.id, product_id: product1.id, created_at: new Date() })

    const products = await shopService.getProducts({ userId: buyer.id })

    assert.lengthOf(products, 2)
    const fav = products.find((p) => p.id === product1.id)
    const notFav = products.find((p) => p.id === product2.id)
    assert.isTrue(fav?.isFavorite)
    assert.isFalse(notFav?.isFavorite)
  })

  test('getCategories returns only active categories', async ({ assert }) => {
    await CategoryFactory.create()
    await CategoryFactory.create()
    await CategoryFactory.apply('disabled').create()

    const categories = await shopService.getCategories()
    assert.lengthOf(categories, 2)
  })
})
