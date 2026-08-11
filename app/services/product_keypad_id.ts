import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/** Distinct from the users' keypad-allocation lock key in KeypadIdService. */
const PRODUCT_KEYPAD_LOCK_KEY = 8999902

/**
 * Allocate the next product keypad ID.
 *
 * `MAX(keypad_id) + 1` on its own is a read-modify-write: two suppliers creating a product
 * at the same time read the same maximum and the second insert dies on the unique index.
 * The advisory lock is transaction-scoped, so the caller must pass the transaction that
 * also performs the insert — otherwise the lock is released before the row exists and the
 * race is back.
 */
export async function allocateProductKeypadId(trx: TransactionClientContract): Promise<number> {
  await trx.rawQuery('SELECT pg_advisory_xact_lock(?)', [PRODUCT_KEYPAD_LOCK_KEY])

  const result = await trx.from('products').max('keypad_id as max').first()
  return Number(result?.max ?? 0) + 1
}

/** Convenience wrapper for callers that have no transaction of their own yet. */
export async function withProductKeypadId<T>(
  handler: (trx: TransactionClientContract, keypadId: number) => Promise<T>
): Promise<T> {
  return db.transaction(async (trx) => handler(trx, await allocateProductKeypadId(trx)))
}
