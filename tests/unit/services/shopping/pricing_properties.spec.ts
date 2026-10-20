import { test } from '@japa/runner'
import fc from 'fast-check'
import {
  MAX_MARGIN_PERCENT,
  breakEvenMarginPercent,
  suggestDraftPrice,
  suggestSellingPrice,
} from '#services/shopping/pricing'
import * as frontend from '../../../../inertia/composables/pricing_rules.ts'

/**
 * Property tests of the price rules. The oracle works in exact integers: a purchase price is
 * whole cents (two decimals, as every form and validator allows) and a margin is whole
 * hundredths of a percent (`decimal([0, 2])` in the margin validator). The documented rule:
 * the price with margin, float noise below half a cent stripped, rounded UP to whole crowns,
 * at least 1 CZK.
 */

const SEED = 20_261_004
const RUNS = 3000

/** The product's last selling price: often missing, zero or negative at the edges. */
const lastPrice = () =>
  fc.oneof(fc.constantFrom(null, 0, -1, 1), fc.integer({ min: -5, max: 100_000 }))

/** Purchase price in cents, up to DELIVERY_MAX_PRICE (100 000 CZK). */
const purchaseCents = fc.integer({ min: 0, max: 10_000_000 })
/** Margin in hundredths of a percent, including out-of-range values the rule must clamp. */
const marginHundredths = fc.integer({ min: -2_000, max: 25_000 })

/**
 * The expected selling price, in exact integer arithmetic. Price in millionths of a crown:
 * cents × (10000 + margin‱) / 10000 × 10000 = cents × (10000 + m).
 * Returns null for the one place the rule is ambiguous — a raw price exactly on half a cent,
 * where the float rounding may go either way.
 */
function expectedPrice(cents: number, margin: number): number | null {
  const m = Math.min(MAX_MARGIN_PERCENT * 100, Math.max(0, margin))
  const micro = BigInt(cents) * BigInt(10_000 + m) // millionths of a crown
  const crowns = micro / 1_000_000n
  const fraction = Number(micro % 1_000_000n) // millionths above the whole crown
  // Float error stays far below this guard at these magnitudes (< 1e-3 of a cent).
  if (Math.abs(fraction - 5_000) <= 10) return null
  const up = fraction >= 5_000 // at least half a cent above → a real price above the crown
  return Math.max(1, Number(crowns) + (up ? 1 : 0))
}

test.group('pricing properties', () => {
  // Mutations caught: Math.ceil → Math.round (every raw price with 0.01–0.49 CZK above a
  // crown), dropping the clamp of the margin, the minimum of 1 CZK, the cent rounding.
  test('the selling price is the price with margin rounded up to whole crowns', ({ assert }) => {
    fc.assert(
      fc.property(purchaseCents, marginHundredths, (cents, margin) => {
        const expected = expectedPrice(cents, margin)
        fc.pre(expected !== null)
        assert.strictEqual(suggestSellingPrice(cents / 100, margin / 100), expected)
      }),
      { seed: SEED, numRuns: RUNS }
    )
  })

  // Mutation caught: the page's copy of the rules drifting from the server's — the page
  // sends its suggestion as the real price on Enter, the server does not recompute it.
  test('the page and the server suggest the same prices', ({ assert }) => {
    const anyMargin = fc.oneof(
      marginHundredths.map((m) => m / 100),
      fc.double({ min: -50, max: 300, noNaN: true })
    )
    const last = lastPrice()
    const purchase = fc.option(
      purchaseCents.map((c) => c / 100),
      { nil: null }
    )
    fc.assert(
      fc.property(purchase, anyMargin, last, (p, m, l) => {
        assert.strictEqual(frontend.suggestDraftPrice(p, m, l), suggestDraftPrice(p, m, l))
        if (p !== null) {
          assert.strictEqual(frontend.suggestSellingPrice(p, m), suggestSellingPrice(p, m))
        }
      }),
      { seed: SEED, numRuns: RUNS }
    )
  })

  // Mutations caught: Math.min instead of Math.max (an established price lowered), a last
  // price of 0 or below taken as a floor, null returned while one source exists.
  test('a draft price is the higher of margin and last price, from whichever exists', ({
    assert,
  }) => {
    const last = lastPrice()
    const purchase = fc.option(purchaseCents, { nil: null })
    fc.assert(
      fc.property(purchase, marginHundredths, last, (cents, margin, lastSold) => {
        const fromMargin = cents === null ? null : suggestSellingPrice(cents / 100, margin / 100)
        const floor = lastSold !== null && lastSold > 0 ? lastSold : null
        const result = suggestDraftPrice(
          cents === null ? null : cents / 100,
          margin / 100,
          lastSold
        )
        if (fromMargin === null && floor === null) return assert.isNull(result)
        assert.strictEqual(result, Math.max(fromMargin ?? 0, floor ?? 0))
      }),
      { seed: SEED, numRuns: RUNS }
    )
  })

  // Mutation caught: a price that falls when the purchase price or the margin rises.
  test('a higher purchase price or margin never lowers the price', ({ assert }) => {
    fc.assert(
      fc.property(
        purchaseCents,
        purchaseCents,
        marginHundredths,
        marginHundredths,
        (a, b, m, n) => {
          const [lowP, highP] = a <= b ? [a, b] : [b, a]
          const [lowM, highM] = m <= n ? [m, n] : [n, m]
          assert.isAtMost(
            suggestSellingPrice(lowP / 100, lowM / 100),
            suggestSellingPrice(highP / 100, highM / 100)
          )
        }
      ),
      { seed: SEED, numRuns: RUNS }
    )
  })

  // With a share r of the pieces never paid for, the paid ones must cover all of them:
  // (1 − r) × (1 + m) ≥ 1. The margin is rounded to hundredths of a percent, so allow that.
  // Mutations caught: r instead of r / (1 − r), the 50 % cap moved, rounding down to whole
  // percent.
  test('the break-even margin really breaks even, and only just', ({ assert }) => {
    fc.assert(
      fc.property(fc.double({ min: 0.0001, max: 0.4999, noNaN: true }), (rate) => {
        const margin = breakEvenMarginPercent(rate) / 100
        assert.isAtLeast((1 - rate) * (1 + margin), 1 - 5e-5, `rate ${rate}`)
        assert.isAtMost((1 - rate) * (1 + margin - 0.0001), 1 + 5e-5, `rate ${rate}`)
        assert.isAtMost(breakEvenMarginPercent(rate), MAX_MARGIN_PERCENT)
      }),
      { seed: SEED, numRuns: RUNS }
    )
    assert.equal(breakEvenMarginPercent(0.5), MAX_MARGIN_PERCENT)
    assert.equal(breakEvenMarginPercent(0), 0)
    assert.equal(breakEvenMarginPercent(-0.1), 0)
  })
})
