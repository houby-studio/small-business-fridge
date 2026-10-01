import '#tests/test_context'
import { test } from '@japa/runner'
import { matchAllergens } from '#services/product_ai/allergen_matching'

const czech = [
  'Lepek (obiloviny)',
  'Korýši',
  'Vejce',
  'Ryby',
  'Arašídy',
  'Sója',
  'Mléko',
  'Skořápkové plody',
  'Celer',
  'Hořčice',
  'Sezam',
  'Oxid siřičitý a siřičitany',
  'Vlčí bob',
  'Měkkýši',
].map((name, i) => ({ id: i + 1, name }))

test.group('Product AI - allergen matching', () => {
  test('maps every EU-14 Open Food Facts tag to the Czech allergen', ({ assert }) => {
    const tags = [
      'gluten',
      'crustaceans',
      'eggs',
      'fish',
      'peanuts',
      'soybeans',
      'milk',
      'nuts',
      'celery',
      'mustard',
      'sesame-seeds',
      'sulphur-dioxide-and-sulphites',
      'lupin',
      'molluscs',
    ]
    assert.deepEqual(
      matchAllergens(tags, czech),
      czech.map((a) => a.id)
    )
  })

  test('Snickers: milk, eggs, peanuts, nuts and soy — and nothing else', ({ assert }) => {
    const ids = matchAllergens(['eggs', 'milk', 'nuts', 'peanuts', 'soybeans'], czech)
    assert.deepEqual(
      ids.map((id) => czech[id - 1].name),
      ['Vejce', 'Arašídy', 'Sója', 'Mléko', 'Skořápkové plody']
    )
  })

  test('"nuts" does not pick peanuts, unknown tags are ignored', ({ assert }) => {
    assert.deepEqual(matchAllergens(['nuts'], czech), [8])
    assert.deepEqual(matchAllergens(['none', 'en:something'], czech), [])
    assert.deepEqual(matchAllergens(['milk'], []), [])
  })

  test('works with English allergen names too', ({ assert }) => {
    assert.deepEqual(
      matchAllergens(
        ['milk', 'peanuts'],
        [
          { id: 1, name: 'Milk' },
          { id: 2, name: 'Peanuts' },
          { id: 3, name: 'Tree nuts' },
        ]
      ),
      [1, 2]
    )
  })
})
