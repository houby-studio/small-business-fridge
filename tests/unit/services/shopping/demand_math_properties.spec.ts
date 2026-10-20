import { test } from '@japa/runner'
import fc from 'fast-check'
import {
  MAX_HORIZON_DAYS,
  MIN_HORIZON_DAYS,
  clampHorizon,
  estimateRate,
  expectedOpenDays,
  inferPackSize,
  median,
  percentile,
  poissonCdf,
  stockoutRisk,
  suggestQuantity,
  tripCadenceDays,
  type DayObservation,
} from '#services/shopping/demand_math'
import { parseLineKey } from '#services/shopping/shopping_list_service'

/**
 * Property tests of the shopping-list arithmetic: what must hold for any history, not just
 * the few hand-picked ones in demand_math.spec.ts. Fixed seed, so CI is reproducible.
 */

const SEED = 20_261_004
const RUNS = 1000

const quantityInput = fc.record({
  ratePerOpenDay: fc.double({ min: 0, max: 40, noNaN: true }),
  openDays: fc.double({ min: 0, max: 60, noNaN: true }),
  stock: fc.integer({ min: -5, max: 500 }),
  packSize: fc.constantFrom(1, 2, 3, 4, 5, 6, 8, 10, 12, 24),
})

const day = fc.record({
  ageDays: fc.integer({ min: 1, max: 84 }),
  open: fc.boolean(),
  available: fc.boolean(),
  sold: fc.integer({ min: 0, max: 30 }),
})

test.group('demand_math properties — quantity', () => {
  // Mutations caught: a safety stock that shrinks with demand, a pack rounding that rounds
  // down, `need` computed from a negative stock.
  test('more open days or a higher rate never buys less; more stock never buys more', ({
    assert,
  }) => {
    fc.assert(
      fc.property(
        quantityInput,
        fc.double({ min: 0, max: 20, noNaN: true }),
        fc.integer({ min: 0, max: 100 }),
        (input, extra, more) => {
          const base = suggestQuantity(input).quantity
          assert.isAtLeast(
            suggestQuantity({ ...input, openDays: input.openDays + extra }).quantity,
            base
          )
          assert.isAtLeast(
            suggestQuantity({ ...input, ratePerOpenDay: input.ratePerOpenDay + extra }).quantity,
            base
          )
          assert.isAtMost(suggestQuantity({ ...input, stock: input.stock + more }).quantity, base)
        }
      ),
      { seed: SEED, numRuns: RUNS }
    )
  })

  // What is bought reaches the target and overshoots by less than one pack: whole packs,
  // except a need under half a pack, which is bought piece by piece.
  // Mutations caught: Math.round instead of Math.ceil (short of the target), a pack added
  // on top, the "small need" rule inverted.
  test('the quantity covers the need in whole packs and overshoots by less than a pack', ({
    assert,
  }) => {
    fc.assert(
      fc.property(quantityInput, (input) => {
        const { need, quantity, target, demand } = suggestQuantity(input)
        assert.isAtLeast(target, demand)
        assert.isAtLeast(need, 0)
        if (need < 1) return assert.equal(quantity, 0)
        assert.isAtLeast(quantity, need)
        if (input.packSize > 2 * need) {
          assert.equal(quantity, Math.ceil(need))
        } else {
          assert.equal(quantity % input.packSize, 0)
          assert.isBelow(quantity - need, input.packSize)
        }
      }),
      { seed: SEED, numRuns: RUNS }
    )
  })

  test('nothing that does not sell is ever bought', ({ assert }) => {
    fc.assert(
      fc.property(quantityInput, (input) => {
        assert.equal(suggestQuantity({ ...input, ratePerOpenDay: 0 }).quantity, 0)
        assert.equal(suggestQuantity({ ...input, openDays: 0 }).quantity, 0)
      }),
      { seed: SEED, numRuns: RUNS }
    )
  })
})

test.group('demand_math properties — rate and risk', () => {
  // An empty shelf or a closed fridge says nothing about demand.
  // Mutation caught: counting unavailable or closed days as days without a sale.
  test('days the item could not be bought or the fridge was closed do not move the rate', ({
    assert,
  }) => {
    fc.assert(
      fc.property(
        fc.array(day, { maxLength: 60 }),
        fc.array(day, { maxLength: 30 }),
        (days, noise) => {
          const ignored = noise.map((d, i) =>
            i % 2 ? { ...d, available: false } : { ...d, open: false }
          )
          const rate = estimateRate(days)
          const mixed = estimateRate([...ignored, ...days])
          assert.closeTo(mixed, rate, 1e-12)
        }
      ),
      { seed: SEED, numRuns: RUNS }
    )
  })

  // The prior pulls the rate below the best day: never above the highest daily sale.
  test('the rate is never negative and never above the best counted day', ({ assert }) => {
    fc.assert(
      fc.property(fc.array(day, { maxLength: 84 }), (days: DayObservation[]) => {
        const rate = estimateRate(days)
        const counted = days.filter((d) => d.open && d.available).map((d) => d.sold)
        assert.isAtLeast(rate, 0)
        assert.isAtMost(rate, counted.length ? Math.max(...counted) : 0)
      }),
      { seed: SEED, numRuns: RUNS }
    )
  })

  // Mutations caught: a CDF that is not monotonic (a loop cut short), a risk that grows
  // with stock or falls with demand, either leaving [0, 1].
  test('the Poisson CDF and the stock-out risk move the right way and stay in [0, 1]', ({
    assert,
  }) => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.double({ min: 0, max: 150, noNaN: true }),
        fc.double({ min: 0, max: 20, noNaN: true }),
        (k, mean, extra) => {
          const cdf = poissonCdf(k, mean)
          assert.isAtLeast(cdf, 0)
          assert.isAtMost(cdf, 1)
          assert.isAtLeast(poissonCdf(k + 1, mean) + 1e-12, cdf)
          assert.isAtMost(poissonCdf(k, mean + extra), cdf + 1e-12)

          const risk = stockoutRisk(k, mean)
          assert.isAtLeast(risk, 0)
          assert.isAtMost(risk, 1)
          assert.isAtMost(stockoutRisk(k + 1, mean), risk + 1e-12)
          assert.isAtLeast(stockoutRisk(k, mean + extra) + 1e-12, risk)
        }
      ),
      { seed: SEED, numRuns: RUNS }
    )
  })

  // P(demand > stock) for a Poisson demand, against a straight sum of the probabilities.
  // Mutation caught: an off-by-one — P(demand >= stock) — which keeps every trend above.
  test('the stock-out risk is the chance that demand exceeds the stock', ({ assert }) => {
    const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1))
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 25 }),
        fc.double({ min: 0.01, max: 25, noNaN: true }),
        (stock, mean) => {
          let atMost = 0
          for (let i = 0; i <= stock; i++) atMost += (Math.exp(-mean) * mean ** i) / factorial(i)
          assert.closeTo(stockoutRisk(stock, mean), 1 - atMost, 1e-9)
        }
      ),
      { seed: SEED, numRuns: RUNS }
    )
    // One piece on the shelf, one sale expected: 1 − 2/e.
    assert.closeTo(stockoutRisk(1, 1), 1 - 2 / Math.E, 1e-12)
  })

  test('expected open days never exceed the horizon and grow with it', ({ assert }) => {
    const probabilities = fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
      minLength: 7,
      maxLength: 7,
    })
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 6 }),
        probabilities,
        (horizon, today, p) => {
          const open = expectedOpenDays(horizon, today, p)
          assert.isAtMost(open, horizon + 1e-9)
          assert.isAtLeast(expectedOpenDays(horizon + 1, today, p) + 1e-12, open)
          // A fridge open every day is open every day of the horizon.
          assert.closeTo(expectedOpenDays(horizon, today, [1, 1, 1, 1, 1, 1, 1]), horizon, 1e-9)
        }
      ),
      { seed: SEED, numRuns: RUNS }
    )
  })
})

test.group('demand_math properties — habits and statistics', () => {
  // Mutation caught: a pack that does not divide most of the amounts, or exceeds the median.
  test('an inferred pack divides at least 70 % of the amounts and is not above their median', ({
    assert,
  }) => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -2, max: 96 }), { maxLength: 12 }), (amounts) => {
        const pack = inferPackSize(amounts)
        const positive = amounts.filter((a) => a > 0)
        if (pack === 1) return
        assert.include([24, 12, 10, 8, 6, 5, 4, 3, 2], pack)
        const fits = positive.filter((a) => a % pack === 0).length
        assert.isAtLeast(fits / positive.length, 0.7)
        const sorted = [...positive].sort((a, b) => a - b)
        assert.isAtMost(pack, sorted[Math.floor(sorted.length / 2)])
      }),
      { seed: SEED, numRuns: RUNS }
    )
  })

  // The order lots were read in must not matter; fewer than three trips is no habit.
  test('the trip cadence ignores the order of the deliveries', ({ assert }) => {
    const hour = 3_600_000
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 24 * 180 }), { maxLength: 20 }), (hours) => {
        const stamps = hours.map((h) => h * hour)
        const cadence = tripCadenceDays(stamps)
        assert.strictEqual(tripCadenceDays([...stamps].reverse()), cadence)
        if (cadence !== null) assert.isAbove(cadence, 0)
      }),
      { seed: SEED, numRuns: RUNS }
    )
    // Deliveries each within six hours of the previous one are one trip, however long the
    // chain: two trips are no habit yet, three a week apart are a weekly one.
    assert.isNull(tripCadenceDays([0, 5 * hour, 10 * hour, 15 * hour, 30 * 24 * hour]))
    assert.equal(tripCadenceDays([0, 5 * hour, 7 * 24 * hour, 14 * 24 * hour]), 7)
  })

  test('median, percentile and the horizon clamp agree with a sorted reference', ({ assert }) => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 1, maxLength: 30 }),
        fc.integer({ min: -10, max: 110 }),
        fc.double({ min: -100, max: 1000, noNaN: true }),
        (values, p, days) => {
          const sorted = [...values].sort((a, b) => a - b)
          const n = sorted.length
          const mid = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
          assert.strictEqual(median(values), mid)
          const clampedP = Math.min(100, Math.max(0, p))
          const rank = Math.max(1, Math.ceil((clampedP / 100) * n))
          assert.strictEqual(percentile(values, p), sorted[rank - 1])
          const horizon = clampHorizon(days)
          assert.isAtLeast(horizon, MIN_HORIZON_DAYS)
          assert.isAtMost(horizon, MAX_HORIZON_DAYS)
          assert.isTrue(Number.isInteger(horizon))
        }
      ),
      { seed: SEED, numRuns: RUNS }
    )
  })
})

test.group('shopping-list line keys', () => {
  const VALID = /^[gpc]-[0-9]{1,9}$/

  // The key comes from a URL and an MCP argument. It parses exactly when it is a kind
  // letter and up to nine ASCII digits — fits a PostgreSQL integer, never a SQL fragment.
  // Mutations caught: `\d+` (overflow ids), a missing anchor, an `i` flag.
  test('a key parses exactly when it is a kind letter and up to nine digits', ({ assert }) => {
    const keyish = fc.oneof(
      fc.string({ unit: 'binary', maxLength: 14 }),
      fc
        .tuple(
          fc.constantFrom('g', 'p', 'c', 'G', 'x', ''),
          fc.constantFrom('-', '_', ''),
          fc.string({ unit: fc.constantFrom(...'0123456789١٢³ .e-'), maxLength: 12 })
        )
        .map(([kind, dash, digits]) => `${kind}${dash}${digits}`),
      // Well-formed apart from the length: 1 to 12 plain digits.
      fc
        .tuple(
          fc.constantFrom('g', 'p', 'c'),
          fc.string({ unit: fc.constantFrom(...'0123456789'), minLength: 1, maxLength: 12 })
        )
        .map(([kind, digits]) => `${kind}-${digits}`)
    )
    fc.assert(
      fc.property(keyish, (key) => {
        const parsed = parseLineKey(key)
        if (!VALID.test(key)) return assert.isNull(parsed, key)
        assert.isNotNull(parsed, key)
        const kind = { g: 'group', p: 'product', c: 'custom' }[key[0] as 'g' | 'p' | 'c']
        assert.deepEqual(parsed, { kind, id: Number(key.slice(2)) })
        assert.isAtMost(parsed!.id, 2_147_483_647)
      }),
      { seed: SEED, numRuns: RUNS }
    )
  })

  // The route that receives the key must accept the same keys the service parses.
  test('the web route accepts exactly the keys the service parses', async ({ assert }) => {
    const { readFile } = await import('node:fs/promises')
    const routes = await readFile(new URL('../../../../start/routes.ts', import.meta.url), 'utf8')
    const patterns = [
      ...routes.matchAll(/shopping-list\/lines\/:key[\s\S]*?\.where\('key', (\/.*?\/)\)/g),
    ]
    assert.lengthOf(patterns, 2)
    for (const [, pattern] of patterns) assert.equal(pattern, '/^[gpc]-\\d{1,9}$/')
  })
})
