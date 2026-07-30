import '#tests/test_context'
import { test } from '@japa/runner'
import { readFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'

test.group('Supplier translations', () => {
  test('allergen empty-state message is localized in Czech', async ({ assert }) => {
    const en = JSON.parse(
      await readFile(app.makePath('resources/lang/en/supplier.json'), 'utf8')
    ) as Record<string, string>
    const cs = JSON.parse(
      await readFile(app.makePath('resources/lang/cs/supplier.json'), 'utf8')
    ) as Record<string, string>

    assert.equal(en.products_no_available_options, 'No available options')
    assert.equal(cs.products_no_available_options, 'Žádné dostupné možnosti')
    assert.notEqual(cs.products_no_available_options, en.products_no_available_options)
  })
})
