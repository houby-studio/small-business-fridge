/**
 * Turn a `?page=` query value into a page number Lucid's paginate() will accept.
 *
 * Anything non-numeric, zero or negative collapses to page 1. Without this a crafted
 * `?page=-1` reaches paginate() and PostgreSQL rejects the resulting negative OFFSET,
 * so every paginated screen answers 500 instead of showing the first page.
 */
export function resolvePage(input: unknown): number {
  const parsed = Number(input)
  if (!Number.isFinite(parsed)) return 1
  return Math.max(1, Math.trunc(parsed))
}
