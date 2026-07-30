import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import Order from '#models/order'
import ProductRating from '#models/product_rating'
import ProductRatingService from '#services/product_rating_service'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { store as throttleStore } from '#middleware/throttle_middleware'

const cleanAll = async () => {
  await db.from('product_rating_upvotes').delete()
  await db.from('product_ratings').delete()
  await db.from('user_favorites').delete()
  await db.from('orders').delete()
  await db.from('deliveries').delete()
  await db.from('product_allergen').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('audit_logs').delete()
  await db.from('auth_access_tokens').delete()
  await db.from('user_auth_identities').delete()
  await db.from('users').delete()
}

/**
 * Flip the public-feed flag for a single test. The default (env unset) is `false`,
 * so the suite mirrors production behaviour unless a test explicitly enables it.
 */
function setPublicFeed(enabled: boolean) {
  app.config.set('ratings.publicFeedEnabled', enabled)
}

async function makeStockedProduct(name: string) {
  const category = await CategoryFactory.create()
  const supplier = await UserFactory.apply('supplier').create()
  const product = await ProductFactory.merge({
    categoryId: category.id,
    displayName: name,
  }).create()
  const delivery = await DeliveryFactory.merge({
    supplierId: supplier.id,
    productId: product.id,
    amountLeft: 10,
    price: 20,
  }).create()
  return { category, supplier, product, delivery }
}

async function makePurchase(userId: number, deliveryId: number, daysAgo: number = 0) {
  const order = await Order.create({ buyerId: userId, deliveryId, channel: 'web' })
  if (daysAgo > 0) {
    await db
      .from('orders')
      .where('id', order.id)
      .update({ created_at: DateTime.utc().minus({ days: daysAgo }).toJSDate() })
  }
  return order
}

test.group('Web ratings', (group) => {
  group.each.setup(async () => {
    throttleStore.clear()
    await cleanAll()
  })
  group.each.teardown(async () => {
    setPublicFeed(false)
    await cleanAll()
  })

  test('GET /ratings requires authentication', async ({ client, assert }) => {
    const response = await client.get('/ratings').redirects(0)
    assert.include([302, 401], response.status())
  })

  test('GET /ratings renders the feed page for an authenticated user', async ({ client }) => {
    const user = await UserFactory.create()
    const response = await client.get('/ratings').loginAs(user)
    response.assertStatus(200)
  })

  test('POST /ratings for a never-purchased product → 403, no row created', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()
    const { product } = await makeStockedProduct('Kofola')

    const response = await client
      .post('/ratings')
      .loginAs(user)
      .form({ productId: product.id, stars: 4, comment: 'foo', visibility: 'public' })
      .withCsrfToken()
      .redirects(0)

    assert.equal(response.status(), 403)
    const count = await db.from('product_ratings').count('* as cnt').first()
    assert.equal(Number(count?.cnt ?? 0), 0)
  })

  test('POST /ratings after a recent purchase creates the rating (forced private with feed off)', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.create()
    const { product, delivery } = await makeStockedProduct('Kofola')
    await makePurchase(user.id, delivery.id)

    const response = await client
      .post('/ratings')
      .loginAs(user)
      .form({ productId: product.id, stars: 5, comment: 'super', visibility: 'public' })
      .withCsrfToken()
      .redirects(0)

    assert.equal(response.status(), 302)
    const row = await db.from('product_ratings').where('user_id', user.id).first()
    assert.exists(row)
    assert.equal(row.stars, 5)
    // Public feed is off → customer rating is forced to private.
    assert.equal(row.visibility, 'private')
  })

  test('repeated POST /ratings for the same product acts as edit (single row)', async ({
    client,
    assert,
  }) => {
    setPublicFeed(true)
    const user = await UserFactory.create()
    const { product, delivery } = await makeStockedProduct('Rajec')
    await makePurchase(user.id, delivery.id)

    const r1 = await client
      .post('/ratings')
      .loginAs(user)
      .form({ productId: product.id, stars: 4, visibility: 'public' })
      .withCsrfToken()
      .redirects(0)
    assert.equal(r1.status(), 302)

    const r2 = await client
      .post('/ratings')
      .loginAs(user)
      .form({ productId: product.id, stars: 5, comment: 'still good', visibility: 'public' })
      .withCsrfToken()
      .redirects(0)
    assert.equal(r2.status(), 302)

    const rows = await db
      .from('product_ratings')
      .where('user_id', user.id)
      .where('product_id', product.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].stars, 5)
    assert.equal(rows[0].visibility, 'public')
  })

  test('rating a purchase older than 14 days → 403 (window closed)', async ({ client, assert }) => {
    const user = await UserFactory.create()
    const { product, delivery } = await makeStockedProduct('Vinea')
    await makePurchase(user.id, delivery.id, 20)

    const response = await client
      .post('/ratings')
      .loginAs(user)
      .form({ productId: product.id, stars: 3, visibility: 'private' })
      .withCsrfToken()
      .redirects(0)

    assert.equal(response.status(), 403)
  })

  test('customer only sees their own ratings when the public feed is off', async ({ assert }) => {
    const alice = await UserFactory.create()
    const bob = await UserFactory.create()
    const { product, delivery } = await makeStockedProduct('Semtex')
    await makePurchase(alice.id, delivery.id)
    await makePurchase(bob.id, delivery.id)

    await ProductRating.create({
      userId: alice.id,
      productId: product.id,
      stars: 5,
      visibility: 'public',
    })
    await ProductRating.create({
      userId: bob.id,
      productId: product.id,
      stars: 2,
      visibility: 'public',
    })

    const forBob = await ProductRatingService.listFeed({
      viewerUserId: bob.id,
      viewerCanSeePrivate: false,
      publicFeedEnabled: false,
    })
    assert.equal(forBob.total, 1)
    assert.equal(forBob.all()[0].userId, bob.id)

    const forBobWithFeed = await ProductRatingService.listFeed({
      viewerUserId: bob.id,
      viewerCanSeePrivate: false,
      publicFeedEnabled: true,
    })
    assert.equal(forBobWithFeed.total, 2)
  })

  test('supplier sees private ratings of others (viewerCanSeePrivate)', async ({ assert }) => {
    const alice = await UserFactory.create()
    const supplier = await UserFactory.apply('supplier').create()
    const { product, delivery } = await makeStockedProduct('Birell')
    await makePurchase(alice.id, delivery.id)

    await ProductRating.create({
      userId: alice.id,
      productId: product.id,
      stars: 1,
      comment: 'zvětralý',
      visibility: 'private',
    })

    const feed = await ProductRatingService.listFeed({
      viewerUserId: supplier.id,
      viewerCanSeePrivate: true,
      publicFeedEnabled: false,
    })
    assert.equal(feed.total, 1)
    assert.equal(feed.all()[0].comment, 'zvětralý')
  })

  test('upvote rules: no self-upvote, customers blocked while feed is off', async ({ assert }) => {
    const alice = await UserFactory.create()
    const bob = await UserFactory.create()
    const { product, delivery } = await makeStockedProduct('Kombucha')
    await makePurchase(alice.id, delivery.id)

    const rating = await ProductRating.create({
      userId: alice.id,
      productId: product.id,
      stars: 4,
      visibility: 'public',
    })

    await assert.rejects(
      () => ProductRatingService.toggleUpvote(rating.id, alice.id, { publicFeedEnabled: true }),
      'RATING_SELF_UPVOTE'
    )
    await assert.rejects(
      () => ProductRatingService.toggleUpvote(rating.id, bob.id, { publicFeedEnabled: false }),
      'RATING_UPVOTE_DISABLED'
    )

    const count = await ProductRatingService.toggleUpvote(rating.id, bob.id, {
      publicFeedEnabled: true,
    })
    assert.equal(count, 1)
    // Toggling again removes the upvote.
    const countAfter = await ProductRatingService.toggleUpvote(rating.id, bob.id, {
      publicFeedEnabled: true,
    })
    assert.equal(countAfter, 0)
  })

  test('DELETE /ratings/:id allowed for owner and admin, forbidden for others', async ({
    client,
    assert,
  }) => {
    const alice = await UserFactory.create()
    const mallory = await UserFactory.create()
    const admin = await UserFactory.apply('admin').create()
    const { product, delivery } = await makeStockedProduct('Cola')
    await makePurchase(alice.id, delivery.id)

    const r1 = await ProductRating.create({
      userId: alice.id,
      productId: product.id,
      stars: 4,
      visibility: 'private',
    })

    const forbidden = await client
      .delete(`/ratings/${r1.id}`)
      .loginAs(mallory)
      .withCsrfToken()
      .redirects(0)
    assert.equal(forbidden.status(), 403)

    const byAdmin = await client
      .delete(`/ratings/${r1.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
    assert.equal(byAdmin.status(), 302)
    assert.isNull(await ProductRating.find(r1.id))
  })

  test('getUnratedProductsForUser lists recent purchases without a rating (deduplicated)', async ({
    assert,
  }) => {
    const user = await UserFactory.create()
    const first = await makeStockedProduct('Mattoni')
    const second = await makeStockedProduct('Magnesia')
    await makePurchase(user.id, first.delivery.id)
    await makePurchase(user.id, first.delivery.id)
    await makePurchase(user.id, second.delivery.id)
    // An old purchase outside the window must not show up.
    const third = await makeStockedProduct('Dobrá voda')
    await makePurchase(user.id, third.delivery.id, 30)

    let unrated = await ProductRatingService.getUnratedProductsForUser(user.id)
    assert.deepEqual(
      unrated.map((u) => u.productId).sort(),
      [first.product.id, second.product.id].sort()
    )

    await ProductRating.create({
      userId: user.id,
      productId: first.product.id,
      stars: 5,
      visibility: 'private',
    })
    unrated = await ProductRatingService.getUnratedProductsForUser(user.id)
    assert.deepEqual(
      unrated.map((u) => u.productId),
      [second.product.id]
    )
  })

  test('aggregates return average and count per product', async ({ assert }) => {
    const alice = await UserFactory.create()
    const bob = await UserFactory.create()
    const { product, delivery } = await makeStockedProduct('Espresso')
    await makePurchase(alice.id, delivery.id)
    await makePurchase(bob.id, delivery.id)

    await ProductRating.create({
      userId: alice.id,
      productId: product.id,
      stars: 5,
      visibility: 'public',
    })
    await ProductRating.create({
      userId: bob.id,
      productId: product.id,
      stars: 2,
      visibility: 'private',
    })

    const aggregate = await ProductRatingService.getProductAggregate(product.id)
    assert.equal(aggregate.count, 2)
    assert.closeTo(aggregate.average!, 3.5, 0.001)
  })
})
