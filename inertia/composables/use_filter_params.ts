export type FilterParams = Record<string, string | number | number[] | null | undefined>

function normalizeFilterParams(params: FilterParams): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params)
      .filter(
        ([, value]) =>
          value !== undefined &&
          value !== null &&
          value !== '' &&
          !(Array.isArray(value) && value.length === 0)
      )
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : String(value)])
  )
}

export function areFilterParamsEqual(a: FilterParams, b: FilterParams): boolean {
  return JSON.stringify(normalizeFilterParams(a)) === JSON.stringify(normalizeFilterParams(b))
}

/** Keys that order or page a list rather than narrow it — they never make "Clear" appear. */
const NON_FILTER_KEYS = ['sortBy', 'sortOrder', 'page']

/**
 * Whether any filter differs from its default. Relies on the page's `buildFilterParams`
 * convention of sending `undefined` for a default value, so the FilterBar's "Clear" only
 * shows when there is something to clear.
 */
export function hasActiveFilters(
  params: FilterParams,
  ignore: string[] = NON_FILTER_KEYS
): boolean {
  const normalized = normalizeFilterParams(params)
  return Object.keys(normalized).some((key) => !ignore.includes(key))
}
