import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    await this.db.rawQuery(`UPDATE users SET email = LOWER(TRIM(email))`)

    const duplicates = await this.db.rawQuery(
      `SELECT LOWER(email) AS email, COUNT(*)::text AS count
       FROM users
       GROUP BY LOWER(email)
       HAVING COUNT(*) > 1`
    )
    const duplicateRows = duplicates.rows as Array<{ email: string; count: string }>
    if (duplicateRows.length > 0) {
      const detail = duplicateRows.map((row) => `${row.email} (${row.count})`).join(', ')
      throw new Error(`Cannot enforce unique normalized emails; duplicates found: ${detail}`)
    }

    await this.db.rawQuery(
      `CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique_idx ON users (LOWER(email))`
    )
  }

  async down() {
    await this.db.rawQuery(`DROP INDEX IF EXISTS users_email_lower_unique_idx`)
  }
}
