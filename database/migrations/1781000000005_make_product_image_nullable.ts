import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Products created outside the web form have no image to upload — the MCP create_product
 * tool says as much in its own description — but the column was NOT NULL, so every such
 * call failed on the insert. The UI already renders a missing image (normalizeImagePath
 * returns null for the legacy placeholders), so nullable is the honest shape.
 */
export default class extends BaseSchema {
  protected tableName = 'products'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('image_path').nullable().alter()
    })
  }

  async down() {
    // Backfill before restoring the constraint, otherwise the alter fails on existing rows.
    this.defer(async (db) => {
      await db.from(this.tableName).whereNull('image_path').update({ image_path: 'preview.png' })
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.string('image_path').notNullable().alter()
    })
  }
}
