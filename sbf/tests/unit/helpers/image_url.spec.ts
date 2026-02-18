import { test } from '@japa/runner'
import { normalizeImagePath } from '#helpers/image_url'

test.group('normalizeImagePath', () => {
  test('returns null for null input', ({ assert }) => {
    assert.isNull(normalizeImagePath(null))
  })

  test('returns null for undefined input', ({ assert }) => {
    assert.isNull(normalizeImagePath(undefined))
  })

  test('returns null for empty string', ({ assert }) => {
    assert.isNull(normalizeImagePath(''))
  })

  test('converts legacy ./images/ path to /uploads/products/', ({ assert }) => {
    assert.equal(normalizeImagePath('./images/beer.png'), '/uploads/products/beer.png')
  })

  test('handles ./images/ paths with subdirectory-like filenames', ({ assert }) => {
    assert.equal(normalizeImagePath('./images/some-product.jpg'), '/uploads/products/some-product.jpg')
  })

  test('returns null for old default placeholder /images/default-product.png', ({ assert }) => {
    assert.isNull(normalizeImagePath('/images/default-product.png'))
  })

  test('returns null for preview.png legacy placeholder', ({ assert }) => {
    assert.isNull(normalizeImagePath('preview.png'))
  })

  test('passes through valid absolute /uploads/products/ paths unchanged', ({ assert }) => {
    assert.equal(normalizeImagePath('/uploads/products/beer.png'), '/uploads/products/beer.png')
  })

  test('passes through any other path unchanged', ({ assert }) => {
    assert.equal(normalizeImagePath('/custom/path/image.jpg'), '/custom/path/image.jpg')
  })
})
