import { test } from '@japa/runner'
import {
  MAX_MARGIN_PERCENT,
  breakEvenMarginPercent,
  roundMoney,
  suggestSellingPrice,
} from '#services/shopping/pricing'

test.group('pricing.suggestSellingPrice', () => {
  test('rounds a shelf price up to whole crowns', ({ assert }) => {
    assert.equal(suggestSellingPrice(14.9, 0), 15)
    assert.equal(suggestSellingPrice(24.9, 0), 25)
    assert.equal(suggestSellingPrice(15, 0), 15)
  })

  test('adds the margin before rounding', ({ assert }) => {
    // 14.90 * 1.05 = 15.645
    assert.equal(suggestSellingPrice(14.9, 5), 16)
    assert.equal(suggestSellingPrice(10, 10), 11)
  })

  test('float noise never adds a crown', ({ assert }) => {
    // 0.1 + 0.2 style artefacts: 19.99 * 1 must stay 20, 16.9 * 1 must stay 17.
    assert.equal(suggestSellingPrice(19.99, 0), 20)
    assert.equal(suggestSellingPrice(16.9, 0), 17)
    assert.equal(suggestSellingPrice(7, 0), 7)
  })

  test('clamps the margin and never goes below one', ({ assert }) => {
    assert.equal(suggestSellingPrice(0, 0), 1)
    assert.equal(suggestSellingPrice(10, -5), 10)
    assert.equal(suggestSellingPrice(10, 500), 10 * (1 + MAX_MARGIN_PERCENT / 100))
  })
})

test.group('pricing.breakEvenMarginPercent', () => {
  test('covers the pieces that are never paid for', ({ assert }) => {
    assert.equal(breakEvenMarginPercent(0), 0)
    // 5 % lost → 5 / 95 = 5.26 %
    assert.equal(breakEvenMarginPercent(0.05), 5.26)
    assert.equal(breakEvenMarginPercent(0.9), MAX_MARGIN_PERCENT)
    assert.equal(breakEvenMarginPercent(Number.NaN), 0)
  })

  test('roundMoney keeps cents', ({ assert }) => {
    assert.equal(roundMoney(14.904999), 14.9)
    assert.equal(roundMoney(3 * 14.9), 44.7)
  })
})
