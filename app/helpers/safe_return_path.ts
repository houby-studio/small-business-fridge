export function normalizeInternalReturnTo(input: unknown, fallback: string = '/profile'): string {
  const candidate = String(input ?? '').trim()
  if (!candidate) return fallback
  if (!candidate.startsWith('/')) return fallback
  if (candidate.startsWith('//')) return fallback
  if (candidate.includes('://')) return fallback
  if (candidate.includes('\\')) return fallback
  return candidate
}
