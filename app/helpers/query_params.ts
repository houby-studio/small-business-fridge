/** The largest value a PostgreSQL `integer` column (every id here) can hold. */
export const MAX_INT4 = 2_147_483_647

/**
 * Turn a query-string id (`?categoryId=`, `?productId=`) into a filter value.
 *
 * Anything that is not a whole number between 1 and the integer column limit is
 * `undefined` — the filter is simply not applied. Without this a crafted
 * `?categoryId=99999999999` reaches PostgreSQL, which rejects it as out of range, and the
 * page answers 500 instead of showing the unfiltered list.
 */
export function positiveInt(input: unknown): number | undefined {
  if (typeof input !== 'string' && typeof input !== 'number') return undefined
  const text = String(input).trim()
  if (!/^\d{1,10}$/.test(text)) return undefined
  const value = Number(text)
  return value >= 1 && value <= MAX_INT4 ? value : undefined
}
