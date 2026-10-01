import '#tests/test_context'
import { test } from '@japa/runner'
import productImagesConfig from '#config/product_images'
import {
  lookupOpenFoodFacts,
  offImageFolder,
  offProductName,
  parseOffProduct,
} from '#services/product_images/open_food_facts'
import { startStubServer } from '#tests/utils/product_image_fixtures'

const IMG = 'https://images.openfoodfacts.org'

test.group('Product images - Open Food Facts', (group) => {
  const original = { ...productImagesConfig.openFoodFacts }
  group.each.teardown(() => {
    Object.assign(productImagesConfig.openFoodFacts, original)
  })

  test('splits a barcode into the OFF image folder', ({ assert }) => {
    assert.equal(offImageFolder('8593893763463'), '859/389/376/3463')
    assert.equal(offImageFolder('20005702'), '20005702')
  })

  test('builds a catalogue-style name and ignores a legal company name as brand', ({ assert }) => {
    assert.equal(
      offProductName({
        product_name: 'SNICKERS',
        product_name_cs: 'Snickers',
        brands: 'MARS POLSKA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
        quantity: '50 g',
      }),
      'Snickers 50 g'
    )
    assert.equal(
      offProductName({ product_name: 'Crisp Bread', brands: 'Danvita' }),
      'Danvita Crisp Bread'
    )
    assert.equal(
      offProductName({ product_name: 'Kofola Original', brands: 'Kofola' }),
      'Kofola Original'
    )
    assert.equal(
      offProductName({ product_name: 'Birell 0,5 l', quantity: '0,5 l' }),
      'Birell 0,5 l'
    )
    assert.equal(offProductName({ product_name: 'snickers 75g' }), 'Snickers 75g')
    assert.isNull(offProductName({}))
  })

  test('offers the full-size front image first, then raw uploads', ({ assert }) => {
    const result = parseOffProduct(
      {
        code: '8593893763463',
        product_name: 'Crisp Bread',
        brands: 'Danvita, Other',
        selected_images: {
          front: { display: { cs: `${IMG}/images/products/859/389/376/3463/front_cs.5.400.jpg` } },
        },
        images: { '1': {}, '2': {}, 'front_cs': {} },
      },
      IMG
    )
    assert.equal(result.productName, 'Danvita Crisp Bread')
    assert.deepEqual(
      result.candidates.map((c) => c.url),
      [
        `${IMG}/images/products/859/389/376/3463/front_cs.5.full.jpg`,
        `${IMG}/images/products/859/389/376/3463/2.jpg`,
        `${IMG}/images/products/859/389/376/3463/1.jpg`,
      ]
    )
    assert.equal(
      result.candidates[0].thumbUrl,
      `${IMG}/images/products/859/389/376/3463/front_cs.5.400.jpg`
    )
  })

  test('looks a barcode up and returns nothing for an unknown one', async ({ assert }) => {
    const server = await startStubServer((req, _body, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (req.url?.startsWith('/api/v2/product/12345678.json')) {
        res.end(
          JSON.stringify({ status: 1, product: { product_name: 'Test', images: { '1': {} } } })
        )
      } else {
        res.end(JSON.stringify({ status: 0 }))
      }
    })
    productImagesConfig.openFoodFacts.baseUrl = server.url
    try {
      const found = await lookupOpenFoodFacts('12345678')
      assert.equal(found.productName, 'Test')
      assert.deepEqual(
        found.candidates.map((c) => c.url),
        [`${server.url}/images/products/12345678/1.jpg`]
      )
      assert.match(String(server.requests[0].headers['user-agent']), /SmallBusinessFridge/)

      const missing = await lookupOpenFoodFacts('87654321')
      assert.deepEqual(missing, { productName: null, candidates: [] })
    } finally {
      await server.close()
    }
  })

  test('does not call out when disabled or for a non-EAN', async ({ assert }) => {
    const server = await startStubServer((_req, _body, res) => res.writeHead(500).end())
    productImagesConfig.openFoodFacts.baseUrl = server.url
    try {
      const notAnEan = await lookupOpenFoodFacts('abc')
      assert.deepEqual(notAnEan.candidates, [])
      productImagesConfig.openFoodFacts.enabled = false
      const disabled = await lookupOpenFoodFacts('12345678')
      assert.deepEqual(disabled.candidates, [])
      assert.lengthOf(server.requests, 0)
    } finally {
      await server.close()
    }
  })
})
