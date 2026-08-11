/**
 * Recognise a PostgreSQL unique-constraint violation (SQLSTATE 23505).
 *
 * Checking the database error rather than pre-querying for a duplicate is deliberate:
 * a "does it already exist?" query can always be overtaken between the check and the
 * insert, so the constraint is the only reliable arbiter. Callers translate this into a
 * field-level message instead of letting it surface as a 500.
 *
 * `constraintContains` narrows the match when one table has several unique constraints
 * (e.g. products has both keypad_id and barcode), so each gets its own message.
 */
export function isUniqueViolation(error: unknown, constraintContains?: string): boolean {
  const candidate = error as { code?: unknown; constraint?: unknown } | null
  if (candidate?.code !== '23505') return false
  if (!constraintContains) return true

  return String(candidate.constraint ?? '').includes(constraintContains)
}
