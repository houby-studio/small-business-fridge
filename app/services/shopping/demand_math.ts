/**
 * The arithmetic behind the shopping list — no database and no clock, so it can be tested
 * with plain numbers. ShoppingListService feeds it the history; docs/shopping-list.md
 * explains the model in prose.
 */

/** How far back sales are read. */
export const LOOKBACK_DAYS = 84
/** Recent weeks count more: a day this old weighs half as much as yesterday. */
export const RATE_HALF_LIFE_DAYS = 28
/**
 * One pseudo-day with no sale mixed into every rate, so a product that sold once on the
 * only day it was in stock reads as 0.5 a day rather than 1.
 */
export const RATE_PRIOR_DAYS = 1
/** Safety stock in standard deviations of the (Poisson) demand: z = 1 covers ~84 %. */
export const SAFETY_Z = 1
export const DEFAULT_HORIZON_DAYS = 14
export const MIN_HORIZON_DAYS = 1
export const MAX_HORIZON_DAYS = 60
/** Deliveries closer together than this belong to one shopping trip. */
export const TRIP_GAP_HOURS = 6
const DAY_MS = 86_400_000

export interface DayObservation {
  /** Days before today (1 = yesterday). */
  ageDays: number
  /** The fridge sold anything at all that day — a working day. */
  open: boolean
  /** The item could be bought: it had stock in the morning, or it sold. */
  available: boolean
  sold: number
}

/**
 * Expected sales per open day. Only days on which the item could actually be bought
 * count — an empty shelf sells nothing, which says nothing about demand.
 */
export function estimateRate(
  days: DayObservation[],
  halfLifeDays = RATE_HALF_LIFE_DAYS,
  priorDays = RATE_PRIOR_DAYS
): number {
  let weightedSold = 0
  let weightedDays = 0
  for (const day of days) {
    if (!day.open || !day.available) continue
    const weight = Math.pow(0.5, day.ageDays / halfLifeDays)
    weightedSold += weight * day.sold
    weightedDays += weight
  }
  if (weightedDays === 0) return 0
  return weightedSold / (weightedDays + priorDays)
}

/**
 * Share of each weekday (0 = Sunday … 6 = Saturday) on which the fridge sold anything.
 * A weekday without any observation falls back to "open on workdays only".
 */
export function openProbabilityByWeekday(days: Array<{ weekday: number; open: boolean }>) {
  const total = Array.from({ length: 7 }, () => 0)
  const open = Array.from({ length: 7 }, () => 0)
  for (const day of days) {
    total[day.weekday] += 1
    if (day.open) open[day.weekday] += 1
  }
  return total.map((count, weekday) => {
    if (count === 0) return weekday === 0 || weekday === 6 ? 0 : 1
    return open[weekday] / count
  })
}

/** Expected open days among the next `horizonDays` calendar days, today included. */
export function expectedOpenDays(
  horizonDays: number,
  todayWeekday: number,
  openProbability: number[]
): number {
  let sum = 0
  for (let i = 0; i < horizonDays; i++) sum += openProbability[(todayWeekday + i) % 7] ?? 0
  return sum
}

/** P(X ≤ k) for X ~ Poisson(mean). */
export function poissonCdf(k: number, mean: number): number {
  if (k < 0) return 0
  if (mean <= 0) return 1
  let term = Math.exp(-mean)
  let sum = term
  const limit = Math.min(Math.floor(k), 100_000)
  for (let i = 1; i <= limit; i++) {
    term *= mean / i
    sum += term
    if (term < 1e-12 && i > mean) break
  }
  return Math.min(1, sum)
}

/** Chance the item sells out before the next trip: P(demand > stock). */
export function stockoutRisk(stock: number, expectedDemand: number): number {
  if (expectedDemand <= 0) return 0
  if (stock <= 0) return 1
  return Math.max(0, 1 - poissonCdf(Math.floor(stock), expectedDemand))
}

const PACK_CANDIDATES = [24, 12, 10, 8, 6, 5, 4, 3, 2]

/**
 * The pack size a supplier usually buys in, read from the amounts they stocked
 * (48, 48, 24 → 24). 1 = no pattern.
 */
export function inferPackSize(amounts: number[]): number {
  const positive = amounts.filter((amount) => amount > 0)
  if (positive.length < 2) return 1
  const sorted = [...positive].sort((a, b) => a - b)
  const middle = sorted[Math.floor(sorted.length / 2)]
  for (const pack of PACK_CANDIDATES) {
    if (pack > middle) continue
    const fits = positive.filter((amount) => amount % pack === 0).length
    if (fits / positive.length >= 0.7) return pack
  }
  return 1
}

export interface QuantitySuggestion {
  /** Expected sales until the next trip. */
  demand: number
  /** Demand plus safety stock. */
  target: number
  /** Pieces missing to reach the target. */
  need: number
  /** What to buy: the need rounded up to whole packs (or pieces for a small need). */
  quantity: number
}

/**
 * Order-up-to policy: buy what the fridge will sell until the next trip, plus a safety
 * margin, minus what is already in it. Rounds up to the usual pack, unless that would
 * more than double a small need.
 */
export function suggestQuantity(input: {
  ratePerOpenDay: number
  openDays: number
  stock: number
  packSize: number
  z?: number
}): QuantitySuggestion {
  const z = input.z ?? SAFETY_Z
  const demand = Math.max(0, input.ratePerOpenDay * input.openDays)
  const safety = demand > 0 ? z * Math.sqrt(demand) : 0
  const target = demand + safety
  const need = Math.max(0, target - Math.max(0, input.stock))
  if (need < 1) return { demand, target, need, quantity: 0 }

  const pack = Math.max(1, Math.floor(input.packSize))
  const quantity = pack > 2 * need ? Math.ceil(need) : Math.ceil(need / pack) * pack
  return { demand, target, need, quantity }
}

/**
 * Days between the supplier's shopping trips (median), read from when they stocked.
 * Deliveries within TRIP_GAP_HOURS of each other are one trip. Null with fewer than three
 * trips — too little to call it a habit.
 */
export function tripCadenceDays(timestamps: number[], gapHours = TRIP_GAP_HOURS): number | null {
  const sorted = [...timestamps].sort((a, b) => a - b)
  const trips: number[] = []
  let previous = Number.NEGATIVE_INFINITY
  for (const time of sorted) {
    if (time - previous > gapHours * 3_600_000) trips.push(time)
    previous = time
  }
  if (trips.length < 3) return null
  const gaps: number[] = []
  for (let i = 1; i < trips.length; i++) gaps.push((trips[i] - trips[i - 1]) / DAY_MS)
  return median(gaps)
}

/** The planning horizon the list starts with: the supplier's habit, within sane bounds. */
export function defaultHorizonDays(cadenceDays: number | null): number {
  if (cadenceDays === null) return DEFAULT_HORIZON_DAYS
  return clampHorizon(Math.round(cadenceDays))
}

export function clampHorizon(days: number): number {
  return Math.min(MAX_HORIZON_DAYS, Math.max(MIN_HORIZON_DAYS, Math.round(days)))
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Median where each value counts `weight` times (a lot of 24 outweighs a lot of 2). */
export function weightedMedian(values: Array<{ value: number; weight: number }>): number | null {
  const usable = values.filter((v) => v.weight > 0 && Number.isFinite(v.value))
  if (usable.length === 0) return null
  const sorted = [...usable].sort((a, b) => a.value - b.value)
  const half = sorted.reduce((sum, v) => sum + v.weight, 0) / 2
  let running = 0
  for (const entry of sorted) {
    running += entry.weight
    if (running >= half) return entry.value
  }
  return sorted[sorted.length - 1].value
}

/** Nearest-rank percentile (p in 0–100). */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length)
  return sorted[Math.max(0, rank - 1)]
}
