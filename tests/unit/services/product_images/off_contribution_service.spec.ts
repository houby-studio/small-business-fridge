import '#tests/test_context'
import { test } from '@japa/runner'
import type http from 'node:http'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import productImagesConfig from '#config/product_images'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import OffContribution from '#models/off_contribution'
import OffContributionService, {
  MAX_ATTEMPTS,
  contributorUuid,
} from '#services/product_images/off_contribution_service'
import { isOffStaging, offHeaders } from '#services/product_images/open_food_facts'
import {
  productOnBackdrop,
  startStubServer,
  type StubServer,
} from '#tests/utils/product_image_fixtures'

const EAN = '8593868002030'

interface OffStub {
  product: null | { product_name?: string; selected_images?: unknown }
  saveStatus?: number
  /** Response per upload, in order; the default is a fresh imgid. */
  uploads?: { status: number; body: unknown }[]
}

/** What a multipart field was set to in a recorded request. */
function field(body: Buffer, name: string): string | null {
  const match = body
    .toString('latin1')
    .match(
      new RegExp(
        `name="${name}"(?:; filename="[^"]*")?\\r\\n(?:Content-Type: [^\\r]*\\r\\n)?\\r\\n([^\\r]*)`
      )
    )
  return match ? match[1] : null
}

function startOff(stub: OffStub): Promise<StubServer> {
  let nextImgid = 1
  let upload = 0
  return startStubServer((req: http.IncomingMessage, _body, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'GET' && req.url?.startsWith(`/api/v2/product/${EAN}.json`)) {
      if (!stub.product) {
        res.statusCode = 404
        res.end(JSON.stringify({ status: 0, status_verbose: 'product not found' }))
      } else {
        res.end(JSON.stringify({ status: 1, product: stub.product }))
      }
      return
    }
    if (req.url === '/cgi/product_jqm2.pl') {
      res.end(JSON.stringify({ status: stub.saveStatus ?? 1, status_verbose: 'fields saved' }))
      return
    }
    if (req.url === '/cgi/product_image_upload.pl') {
      const scripted = stub.uploads?.[upload++]
      if (scripted) {
        res.statusCode = scripted.status
        res.end(JSON.stringify(scripted.body))
        return
      }
      res.end(JSON.stringify({ status: 'status ok', image: { imgid: nextImgid++ } }))
      return
    }
    res.statusCode = 404
    res.end('{}')
  })
}

const cleanAll = async () => {
  await db.from('off_contributions').delete()
  await db.from('audit_logs').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('users').delete()
}

async function setup(options: { photo?: boolean; background?: 'auto' | 'none' } = {}) {
  const supplier = await UserFactory.apply('supplier').create()
  const product = await ProductFactory.with('category')
    .merge({ displayName: 'Kofola Original 0,5 l', barcode: EAN })
    .create()
  const original = options.photo
    ? {
        data: await productOnBackdrop({ product: { width: 300, height: 500 }, format: 'jpeg' }),
        mime: 'image/jpeg',
      }
    : null
  const contribution = await new OffContributionService().queue({
    product,
    userId: supplier.id,
    original,
    background: options.background ?? 'auto',
  })
  return { supplier, product, contribution: contribution! }
}

test.group('OffContributionService', (group) => {
  const originalOff = { ...productImagesConfig.openFoodFacts }
  let server: StubServer | null = null

  group.each.setup(async () => {
    await cleanAll()
    Object.assign(productImagesConfig.openFoodFacts, {
      enabled: true,
      userId: 'fridgora-test',
      password: 'secret',
    })
  })
  group.each.teardown(async () => {
    Object.assign(productImagesConfig.openFoodFacts, originalOff)
    await server?.close()
    server = null
    await cleanAll()
  })

  test('creates an unknown product and adds the cut-out as front, the original as more', async ({
    assert,
  }) => {
    server = await startOff({ product: null })
    productImagesConfig.openFoodFacts.baseUrl = server.url
    const { supplier, product, contribution } = await setup({ photo: true })

    await new OffContributionService().send(contribution)

    const save = server.requests.find((r) => r.url === '/cgi/product_jqm2.pl')!
    assert.equal(field(save.body, 'code'), EAN)
    assert.equal(field(save.body, 'product_name_cs'), 'Kofola Original 0,5 l')
    assert.equal(field(save.body, 'lang'), 'cs')
    assert.equal(field(save.body, 'user_id'), 'fridgora-test')
    assert.equal(field(save.body, 'app_name'), 'Fridgora')
    assert.equal(field(save.body, 'app_uuid'), contributorUuid(supplier.id))

    const uploads = server.requests.filter((r) => r.url === '/cgi/product_image_upload.pl')
    assert.deepEqual(
      uploads.map((u) => field(u.body, 'imagefield')),
      ['front_cs', 'other']
    )
    assert.isNotNull(field(uploads[0].body, 'imgupload_front_cs'))
    assert.match(String(server.requests[0].headers['user-agent']), /^Fridgora\//)

    await contribution.refresh()
    assert.equal(contribution.status, 'done')
    assert.isNull(contribution.originalImage)
    assert.deepEqual(contribution.result, {
      productCreated: true,
      nameSent: true,
      images: [
        { kind: 'cutout', imagefield: 'front_cs', imgid: 1 },
        { kind: 'original', imagefield: 'other', imgid: 2 },
      ],
    })

    const audit = await db
      .from('audit_logs')
      .where('action', 'product.off_contributed')
      .where('entity_id', product.id)
      .firstOrFail()
    assert.isNull(audit.user_id)
    assert.equal(audit.target_user_id, supplier.id)
  })

  test('never overwrites a name or a front picture OFF already has', async ({ assert }) => {
    server = await startOff({
      product: {
        product_name: 'Kofola',
        selected_images: { front: { display: { cs: 'https://x/front.400.jpg' } } },
      },
    })
    productImagesConfig.openFoodFacts.baseUrl = server.url
    const { contribution } = await setup({ photo: true })

    await new OffContributionService().send(contribution)

    assert.isUndefined(server.requests.find((r) => r.url === '/cgi/product_jqm2.pl'))
    const uploads = server.requests.filter((r) => r.url === '/cgi/product_image_upload.pl')
    assert.deepEqual(
      uploads.map((u) => field(u.body, 'imagefield')),
      ['other', 'other']
    )
    await contribution.refresh()
    assert.equal(contribution.status, 'done')
    assert.isFalse(contribution.result!.productCreated)
    assert.isFalse(contribution.result!.nameSent)
  })

  test('with the background kept only the original goes, as the front', async ({ assert }) => {
    server = await startOff({ product: { product_name: 'Kofola' } })
    productImagesConfig.openFoodFacts.baseUrl = server.url
    const { contribution } = await setup({ photo: true, background: 'none' })

    await new OffContributionService().send(contribution)

    const uploads = server.requests.filter((r) => r.url === '/cgi/product_image_upload.pl')
    assert.deepEqual(
      uploads.map((u) => field(u.body, 'imagefield')),
      ['front_cs']
    )
    await contribution.refresh()
    assert.deepEqual(contribution.result!.images, [
      { kind: 'cutout', imagefield: null, imgid: null, skipped: 'no_cutout' },
      { kind: 'original', imagefield: 'front_cs', imgid: 1 },
    ])
  })

  test('a photo OFF already has or rejects is skipped, not retried', async ({ assert }) => {
    server = await startOff({
      product: { product_name: 'Kofola' },
      uploads: [
        { status: 200, body: { status: 'status not ok', imgid: -3, error: 'already exists' } },
        { status: 200, body: { status: 'status not ok', imgid: -4, error: 'too small' } },
      ],
    })
    productImagesConfig.openFoodFacts.baseUrl = server.url
    const { contribution } = await setup({ photo: true })

    await new OffContributionService().send(contribution)

    await contribution.refresh()
    assert.equal(contribution.status, 'done')
    assert.deepEqual(contribution.result!.images, [
      { kind: 'cutout', imagefield: 'front_cs', imgid: null, skipped: 'duplicate' },
      { kind: 'original', imagefield: 'front_cs', imgid: null, skipped: 'too small' },
    ])
  })

  test('a failed round is retried later and continues where it stopped', async ({ assert }) => {
    server = await startOff({
      product: null,
      uploads: [{ status: 502, body: { error: 'bad gateway' } }],
    })
    productImagesConfig.openFoodFacts.baseUrl = server.url
    const { contribution } = await setup({ photo: true })
    const service = new OffContributionService()

    await service.send(contribution)
    await contribution.refresh()
    assert.equal(contribution.status, 'pending')
    assert.equal(contribution.attempts, 1)
    assert.match(contribution.lastError!, /uploading the photo failed/)
    assert.isTrue(contribution.nextAttemptAt > DateTime.now().plus({ minutes: 4 }))
    assert.isTrue(contribution.result!.nameSent)
    assert.isNotNull(contribution.originalImage)

    // Not due yet: the tick leaves it alone.
    assert.equal(await service.processDue(), 0)

    contribution.nextAttemptAt = DateTime.now().minus({ seconds: 1 })
    await contribution.save()
    assert.equal(await service.processDue(), 1)

    await contribution.refresh()
    assert.equal(contribution.status, 'done')
    assert.lengthOf(
      server.requests.filter((r) => r.url === '/cgi/product_jqm2.pl'),
      1,
      'the name is not sent twice'
    )
  })

  test('gives up after the last attempt and drops the photo', async ({ assert }) => {
    server = await startOff({ product: null, saveStatus: 0 })
    productImagesConfig.openFoodFacts.baseUrl = server.url
    const { contribution, product } = await setup({ photo: true })
    contribution.attempts = MAX_ATTEMPTS - 1
    await contribution.save()

    await new OffContributionService().send(contribution)

    await contribution.refresh()
    assert.equal(contribution.status, 'failed')
    assert.isNull(contribution.originalImage)
    assert.match(contribution.lastError!, /saving the product failed/)
    const audit = await db
      .from('audit_logs')
      .where('action', 'product.off_contribution_failed')
      .where('entity_id', product.id)
      .first()
    assert.exists(audit)
  })

  test('queues only public EANs, once per barcode without a new photo', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const service = new OffContributionService()

    const inStore = await ProductFactory.with('category')
      .merge({ barcode: '2005702000004' })
      .create()
    assert.isNull(await service.queue({ product: inStore, userId: supplier.id }))

    const product = await ProductFactory.with('category').merge({ barcode: EAN }).create()
    assert.isNotNull(await service.queue({ product, userId: supplier.id }))
    assert.isNull(await service.queue({ product, userId: supplier.id }), 'name and EAN once')
    assert.isNotNull(
      await service.queue({
        product,
        userId: supplier.id,
        original: { data: Buffer.from('x'), mime: 'image/jpeg' },
      }),
      'a new own photo still goes'
    )

    const shared = await db.from('audit_logs').where('action', 'product.off_shared')
    assert.lengthOf(shared, 2)
    assert.equal(shared[0].user_id, supplier.id)
  })

  test('queues nothing without the instance OFF account', async ({ assert }) => {
    productImagesConfig.openFoodFacts.password = ''
    const supplier = await UserFactory.apply('supplier').create()
    const product = await ProductFactory.with('category').merge({ barcode: EAN }).create()

    assert.isFalse(OffContributionService.isEnabled())
    assert.isNull(await new OffContributionService().queue({ product, userId: supplier.id }))
    assert.lengthOf(await OffContribution.all(), 0)
  })

  test('recognises the staging server and keeps the contributor id stable', ({ assert }) => {
    assert.isTrue(isOffStaging('https://world.openfoodfacts.net'))
    assert.isFalse(isOffStaging('https://world.openfoodfacts.org'))
    assert.isFalse(isOffStaging('https://openfoodfacts.net.evil.example'))
    assert.equal(offHeaders('https://world.openfoodfacts.net').Authorization, 'Basic b2ZmOm9mZg==')
    assert.isUndefined(offHeaders('https://world.openfoodfacts.org').Authorization)
    assert.equal(contributorUuid(7), contributorUuid(7))
    assert.notEqual(contributorUuid(7), contributorUuid(8))
    assert.match(
      contributorUuid(7),
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })
})
