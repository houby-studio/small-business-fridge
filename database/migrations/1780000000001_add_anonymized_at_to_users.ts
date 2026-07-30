import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('anonymized_at', { useTz: true }).nullable()
      table.timestamp('disabled_at', { useTz: true }).nullable()
    })

    // Backfill disabled_at for users already disabled before this migration.
    // updated_at is the closest proxy we have for when the flag was last touched.
    this.defer(async (db) => {
      await db.rawQuery(
        `UPDATE users SET disabled_at = updated_at WHERE is_disabled = true AND disabled_at IS NULL`
      )
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('anonymized_at')
      table.dropColumn('disabled_at')
    })
  }
}
