import { test } from '@japa/runner'
import {
  DEFAULT_HORIZON_DAYS,
  MAX_HORIZON_DAYS,
  defaultHorizonDays,
  estimateRate,
  expectedOpenDays,
  inferPackSize,
  median,
  openProbabilityByWeekday,
  percentile,
  poissonCdf,
  stockoutRisk,
  suggestQuantity,
  tripCadenceDays,
  weightedMedian,
  type DayObservation,
} from '#services/shopping/demand_math'

const day = (ageDays: number, sold: number, available = true, open = true): DayObservation => ({
  ageDays,
  sold,
  available,
  open,
})

test.group('demand_math.estimateRate', () => {
  test('ignores days the item could not be bought', ({ assert }) => {
    const inStock = [day(1, 2), day(2, 2), day(3, 2), day(4, 2)]
    const withEmptyShelf = [...inStock, day(5, 0, false), day(6, 0, false), day(7, 0, false)]
    assert.closeTo(estimateRate(withEmptyShelf, 1e9, 0), 2, 1e-9)
    assert.equal(estimateRate(withEmptyShelf), estimateRate(inStock))
  })

  test('ignores days the fridge was not in use', ({ assert }) => {
    const rate = estimateRate([day(1, 3), day(2, 0, true, false), day(3, 3)], 1e9, 0)
    assert.closeTo(rate, 3, 1e-9)
  })

  test('the prior keeps a single lucky day from reading as a full rate', ({ assert }) => {
    assert.closeTo(estimateRate([day(1, 1)], 1e9, 1), 0.5, 1e-9)
    assert.equal(estimateRate([]), 0)
    assert.equal(estimateRate([day(1, 5, false)]), 0)
  })

  test('recent days weigh more than old ones', ({ assert }) => {
    const risingDemand = [day(1, 4), day(60, 0)]
    const fallingDemand = [day(1, 0), day(60, 4)]
    assert.isAbove(estimateRate(risingDemand), estimateRate(fallingDemand))
  })
})

test.group('demand_math calendar', () => {
  test('weekday probabilities fall back to workdays without data', ({ assert }) => {
    const probability = openProbabilityByWeekday([
      { weekday: 1, open: true },
      { weekday: 1, open: false },
      { weekday: 6, open: true },
    ])
    assert.equal(probability[1], 0.5)
    assert.equal(probability[6], 1)
    assert.equal(probability[0], 0)
    assert.equal(probability[3], 1)
  })

  test('expected open days walk the week from today', ({ assert }) => {
    const workdays = [0, 1, 1, 1, 1, 1, 0]
    // From Friday (5): Fri, Sat, Sun, Mon → 2 open days.
    assert.equal(expectedOpenDays(4, 5, workdays), 2)
    assert.equal(expectedOpenDays(14, 1, workdays), 10)
  })
})

test.group('demand_math Poisson', () => {
  test('cdf matches known values', ({ assert }) => {
    assert.closeTo(poissonCdf(0, 1), Math.exp(-1), 1e-12)
    assert.closeTo(poissonCdf(2, 2), 5 * Math.exp(-2), 1e-12)
    assert.equal(poissonCdf(-1, 3), 0)
    assert.equal(poissonCdf(3, 0), 1)
  })

  test('stockout risk grows with demand and shrinks with stock', ({ assert }) => {
    assert.equal(stockoutRisk(0, 5), 1)
    assert.equal(stockoutRisk(10, 0), 0)
    assert.isAbove(stockoutRisk(5, 8), stockoutRisk(5, 3))
    assert.isAbove(stockoutRisk(3, 5), stockoutRisk(10, 5))
  })
})

test.group('demand_math quantities', () => {
  test('pack size comes from the usual stocked amounts', ({ assert }) => {
    assert.equal(inferPackSize([48, 48, 24]), 24)
    assert.equal(inferPackSize([12, 24, 36]), 12)
    assert.equal(inferPackSize([5, 10]), 5)
    assert.equal(inferPackSize([3, 5, 4]), 1)
    assert.equal(inferPackSize([24]), 1)
  })

  test('buys the demand plus safety minus stock, in whole packs', ({ assert }) => {
    const result = suggestQuantity({ ratePerOpenDay: 1.4, openDays: 10, stock: 0, packSize: 24 })
    assert.closeTo(result.demand, 14, 1e-9)
    assert.isAbove(result.target, result.demand)
    assert.equal(result.quantity, 24)
  })

  test('enough stock means nothing to buy', ({ assert }) => {
    const result = suggestQuantity({ ratePerOpenDay: 1, openDays: 5, stock: 20, packSize: 6 })
    assert.equal(result.quantity, 0)
  })

  test('a small need is not blown up to a big pack', ({ assert }) => {
    const result = suggestQuantity({ ratePerOpenDay: 0.3, openDays: 5, stock: 0, packSize: 24 })
    assert.isAbove(result.quantity, 0)
    assert.isBelow(result.quantity, 24)
  })

  test('nothing sells, nothing to buy', ({ assert }) => {
    assert.equal(
      suggestQuantity({ ratePerOpenDay: 0, openDays: 10, stock: 0, packSize: 1 }).quantity,
      0
    )
  })
})

test.group('demand_math shopping habit', () => {
  const HOUR = 3_600_000
  const DAY = 24 * HOUR

  test('deliveries hours apart are one trip; the median gap is the habit', ({ assert }) => {
    const start = Date.UTC(2026, 0, 5, 7)
    const times = [
      start,
      start + 5 * 60_000,
      start + 7 * DAY,
      start + 7 * DAY + HOUR,
      start + 14 * DAY,
      start + 21 * DAY,
    ]
    assert.equal(tripCadenceDays(times), 7)
  })

  test('too few trips give no habit and the default horizon', ({ assert }) => {
    assert.isNull(tripCadenceDays([0, 10 * DAY]))
    assert.equal(defaultHorizonDays(null), DEFAULT_HORIZON_DAYS)
    assert.equal(defaultHorizonDays(500), MAX_HORIZON_DAYS)
    assert.equal(defaultHorizonDays(20.6), 21)
  })
})

test.group('demand_math statistics', () => {
  test('median, weighted median and percentile', ({ assert }) => {
    assert.equal(median([3, 1, 2]), 2)
    assert.equal(median([4, 1, 2, 3]), 2.5)
    assert.isNull(median([]))
    assert.equal(
      weightedMedian([
        { value: 14.9, weight: 48 },
        { value: 19.9, weight: 6 },
      ]),
      14.9
    )
    assert.equal(percentile([17, 12, 14, 16], 25), 12)
    assert.isNull(percentile([], 50))
  })
})
