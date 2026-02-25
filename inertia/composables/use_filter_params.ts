export type FilterParams = Record<string, string | number | null | undefined>

function normalizeFilterParams(params: FilterParams): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, String(value)])
  )
}

export function areFilterParamsEqual(a: FilterParams, b: FilterParams): boolean {
  return JSON.stringify(normalizeFilterParams(a)) === JSON.stringify(normalizeFilterParams(b))
}
