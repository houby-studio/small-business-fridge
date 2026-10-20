import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import ProductService from '#services/product_service'

const service = new ProductService()

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

async function names(search: string) {
  const page = await service.getProductsPaginated(1, 20, { search })
  return page.all().map((product) => product.displayName)
}

test.group('ProductService — catalogue search', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('every word has to match, in any order, by name or barcode', async ({ assert }) => {
    const category = await CategoryFactory.create()
    for (const [displayName, barcode] of [
      ['Coca-Cola Zero 0,5 l', '5449000131805'],
      ['Coca-Cola 0,33 l', '5449000000996'],
      ['Pepsi Zero', '4060800001276'],
      ['Monster Ultra', null],
    ] as const) {
      await ProductFactory.merge({ categoryId: category.id, displayName, barcode }).create()
    }

    assert.deepEqual(await names('zero cola'), ['Coca-Cola Zero 0,5 l'])
    assert.deepEqual(await names('zero'), ['Coca-Cola Zero 0,5 l', 'Pepsi Zero'])
    assert.deepEqual(await names('  Cola   0,33 '), ['Coca-Cola 0,33 l'])
    // One word by barcode, the other by name.
    assert.deepEqual(await names('544900 zero'), ['Coca-Cola Zero 0,5 l'])
    assert.deepEqual(await names('cola monster'), [])
    // LIKE wildcards are plain characters here.
    assert.deepEqual(await names('0,5_l'), [])
    assert.deepEqual(await names('%'), [])
    assert.lengthOf(await names(''), 4)
  })

  test('a whole number finds the kiosk code exactly, combined with other words', async ({
    assert,
  }) => {
    const category = await CategoryFactory.create()
    await ProductFactory.merge({
      categoryId: category.id,
      displayName: 'Kofola',
      keypadId: 12,
      barcode: null,
    }).create()
    await ProductFactory.merge({
      categoryId: category.id,
      displayName: 'Mattoni',
      keypadId: 112,
      barcode: null,
    }).create()
    await ProductFactory.merge({
      categoryId: category.id,
      displayName: 'Rajec',
      keypadId: 7,
      barcode: '8594000120001',
    }).create()

    assert.deepEqual(await names('12'), ['Kofola', 'Rajec'])
    assert.deepEqual(await names('112'), ['Mattoni'])
    assert.deepEqual(await names('kofola 12'), ['Kofola'])
    assert.deepEqual(await names('mattoni 12'), [])
  })

  test('search tokens are split on whitespace and escaped', ({ assert }) => {
    assert.deepEqual(ProductService.searchTokens(' cola  zero\t0,5 '), ['cola', 'zero', '0,5'])
    assert.deepEqual(ProductService.searchTokens('50%_a\\b'), ['50\\%\\_a\\\\b'])
    assert.deepEqual(ProductService.searchTokens(undefined), [])
  })
})
