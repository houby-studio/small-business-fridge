import { test } from '@japa/runner'
import {
  MAX_MARGIN_PERCENT,
  breakEvenMarginPercent,
  roundMoney,
  suggestDraftPrice,
  suggestSellingPrice,
} from '#services/shopping/pricing'
import * as frontend from '../../../../inertia/composables/pricing_rules.ts'

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

  test('rounds up, never to the nearest crown', ({ assert }) => {
    // Values where Math.round and Math.ceil disagree — a "round" would undercharge.
    assert.equal(suggestSellingPrice(14.2, 0), 15)
    assert.equal(suggestSellingPrice(10.01, 0), 11)
    assert.equal(suggestSellingPrice(10, 3), 11) // 10.30
    assert.equal(suggestSellingPrice(20.2, 1), 21) // 20.402
  })

  test('clamps the margin and never goes below one', ({ assert }) => {
    assert.equal(suggestSellingPrice(0, 0), 1)
    assert.equal(suggestSellingPrice(10, -5), 10)
    assert.equal(suggestSellingPrice(10, 500), 10 * (1 + MAX_MARGIN_PERCENT / 100))
  })
})

test.group('pricing.suggestDraftPrice', () => {
  test('purchase plus margin, but never below the last selling price', ({ assert }) => {
    assert.equal(suggestDraftPrice(14.9, 0, 18), 18)
    assert.equal(suggestDraftPrice(14.9, 30, 18), 20) // 19.37 beats the old 18
    assert.equal(suggestDraftPrice(14.2, 0, null), 15)
    assert.equal(suggestDraftPrice(null, 10, 18), 18)
    assert.equal(suggestDraftPrice(0, 0, null), 1)
    assert.isNull(suggestDraftPrice(null, 10, null))
    assert.isNull(suggestDraftPrice(undefined, 0, 0))
  })
})

/** The page suggests prices with its own copy of the rules; it must agree with the server. */
test.group('pricing parity with inertia/composables/pricing_rules.ts', () => {
  const purchases = [0, 0.01, 1, 7, 9.99, 10, 10.01, 12.9, 14.2, 14.9, 15.645, 19.99, 20.2, 99.5]
  const margins = [-5, 0, 1, 3, 5, 10, 12.5, 33, 100, 500]
  const lasts = [null, 0, 1, 15, 18, 25]

  test('suggestSellingPrice', ({ assert }) => {
    assert.equal(frontend.MAX_MARGIN_PERCENT, MAX_MARGIN_PERCENT)
    for (const purchase of purchases) {
      for (const margin of margins) {
        assert.equal(
          frontend.suggestSellingPrice(purchase, margin),
          suggestSellingPrice(purchase, margin),
          `${purchase} @ ${margin} %`
        )
      }
    }
  })

  test('suggestDraftPrice', ({ assert }) => {
    for (const purchase of [null, ...purchases]) {
      for (const margin of margins) {
        for (const last of lasts) {
          assert.equal(
            frontend.suggestDraftPrice(purchase, margin, last),
            suggestDraftPrice(purchase, margin, last),
            `${purchase} @ ${margin} %, last ${last}`
          )
        }
      }
    }
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
