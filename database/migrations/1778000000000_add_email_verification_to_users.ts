import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    await this.db.rawQuery(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz NULL`
    )
    await this.db.rawQuery(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email varchar(255) NULL`
    )

    // Existing accounts are treated as verified during rollout.
    await this.db.rawQuery(
      `UPDATE users SET email_verified_at = NOW() WHERE email_verified_at IS NULL`
    )
  }

  async down() {
    await this.db.rawQuery(`ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at`)
    await this.db.rawQuery(`ALTER TABLE users DROP COLUMN IF EXISTS pending_email`)
  }
}
