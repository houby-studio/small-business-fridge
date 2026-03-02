import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    await this.db.rawQuery(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_iban varchar(24) NULL`
    )
    await this.db.rawQuery(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS iban_verified_at timestamptz NULL`
    )
    await this.db.rawQuery(`UPDATE users SET iban_verified_at = NOW() WHERE iban IS NOT NULL`)
  }

  async down() {
    await this.db.rawQuery(`ALTER TABLE users DROP COLUMN IF EXISTS pending_iban`)
    await this.db.rawQuery(`ALTER TABLE users DROP COLUMN IF EXISTS iban_verified_at`)
  }
}
