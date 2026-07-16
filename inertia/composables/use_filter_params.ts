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
