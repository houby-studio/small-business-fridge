import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Handing a leaving supplier's stock over to a colleague splits each lot: the new lot
 * points back at the one it came from (`transferred_from_id`), and both lots keep a
 * `transfer` correction record with the date, so the history can say who handed over
 * what to whom.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('deliveries', (table) => {
      table
        .integer('transferred_from_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('deliveries')
        .onDelete('RESTRICT')
      table.index(['transferred_from_id'], 'deliveries_transferred_from_id_idx')
    })
    this.schema.raw(`
      ALTER TABLE delivery_corrections DROP CONSTRAINT IF EXISTS delivery_corrections_kind_check;
      ALTER TABLE delivery_corrections ADD CONSTRAINT delivery_corrections_kind_check
        CHECK (kind IN ('update', 'void', 'reprice', 'transfer'));
    `)
  }

  async down() {
    this.schema.raw(`
      DELETE FROM delivery_corrections WHERE kind = 'transfer';
      ALTER TABLE delivery_corrections DROP CONSTRAINT IF EXISTS delivery_corrections_kind_check;
      ALTER TABLE delivery_corrections ADD CONSTRAINT delivery_corrections_kind_check
        CHECK (kind IN ('update', 'void', 'reprice'));
    `)
    this.schema.alterTable('deliveries', (table) => {
      table.dropIndex(['transferred_from_id'], 'deliveries_transferred_from_id_idx')
      table.dropColumn('transferred_from_id')
    })
  }
}
