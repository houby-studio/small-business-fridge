import db from '@adonisjs/lucid/services/db'

type RawBindings = Parameters<typeof db.rawQuery>[1]

type SqlExecutor = {
  rawQuery: (sql: string, bindings?: RawBindings) => unknown
}

export default class KeypadIdService {
  private static readonly reservedMigrationPlaceholderKeypadId = 89999
  private static readonly allocationLockKey = 8999901

  /**
   * Returns the lowest positive keypad ID not currently used by any user.
   * The migration placeholder keypad ID (89999) is excluded from range growth.
   */
  private async allocateWithExecutor(queryExecutor: SqlExecutor): Promise<number> {
    await queryExecutor.rawQuery('SELECT pg_advisory_xact_lock(?)', [
      KeypadIdService.allocationLockKey,
    ])

    const result = (await queryExecutor.rawQuery(
      `SELECT series.keypad_id
       FROM generate_series(
           1,
           COALESCE(
             (SELECT MAX(u.keypad_id) FROM users u WHERE u.keypad_id <> ?),
             0
           ) + 1
         ) AS series(keypad_id)
       LEFT JOIN users existing ON existing.keypad_id = series.keypad_id
       WHERE existing.id IS NULL
       ORDER BY series.keypad_id ASC
       LIMIT 1`,
      [KeypadIdService.reservedMigrationPlaceholderKeypadId]
    )) as { rows: Array<{ keypad_id?: unknown }> }

    const rawKeypadId = result.rows[0]?.keypad_id
    const keypadId = typeof rawKeypadId === 'number' ? rawKeypadId : Number(rawKeypadId)
    if (!Number.isInteger(keypadId) || keypadId <= 0) {
      throw new Error('Failed to allocate next available keypad ID')
    }

    return keypadId
  }

  async getNextAvailableUserKeypadId(executor?: SqlExecutor): Promise<number> {
    if (executor) {
      return this.allocateWithExecutor(executor)
    }

    return db.transaction(async (trx) => {
      return this.allocateWithExecutor(trx as unknown as SqlExecutor)
    })
  }
}
