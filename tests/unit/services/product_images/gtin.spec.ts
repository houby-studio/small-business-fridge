import { test } from '@japa/runner'
import { isPublicGtin } from '#services/product_images/gtin'

test.group('Product images - public GTIN', () => {
  test('accepts real trade item codes', ({ assert }) => {
    assert.isTrue(isPublicGtin('8593868002030')) // EAN-13, Czech prefix
    assert.isTrue(isPublicGtin('5901234123457'))
    assert.isTrue(isPublicGtin('96385074')) // EAN-8
    assert.isTrue(isPublicGtin('40123455'))
    assert.isTrue(isPublicGtin('036000291452')) // UPC-A
    assert.isTrue(isPublicGtin('00859386800205')) // GTIN-14, indicator 0
    assert.isTrue(isPublicGtin(' 8593868002030 '))
  })

  test('rejects a wrong check digit and odd lengths', ({ assert }) => {
    assert.isFalse(isPublicGtin('8593868002031'))
    assert.isFalse(isPublicGtin('123456789'))
    assert.isFalse(isPublicGtin('85938680020'))
    assert.isFalse(isPublicGtin('859386800203a'))
    assert.isFalse(isPublicGtin(''))
  })

  test('rejects in-store codes, coupons, ISBN/ISSN and outer cases', ({ assert }) => {
    assert.isFalse(isPublicGtin('2005702000004')) // variable weight / shop label
    assert.isFalse(isPublicGtin('0500000000005')) // coupon
    assert.isFalse(isPublicGtin('9788020000002')) // ISBN
    assert.isFalse(isPublicGtin('20123451')) // EAN-8 restricted circulation
    assert.isFalse(isPublicGtin('00123457'))
    assert.isFalse(isPublicGtin('18593868002037')) // GTIN-14 of a case, not the item
  })
})
