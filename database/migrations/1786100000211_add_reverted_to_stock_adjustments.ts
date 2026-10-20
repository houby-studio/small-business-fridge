import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A write-off entered by mistake can be taken back within a few days: the pieces return
 * to the same lot and the row stays in the history, marked as reverted, so nothing that
 * was recorded disappears. Reverted rows count neither as shrinkage nor in the earnings.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('stock_adjustments', (table) => {
      table.timestamp('reverted_at').nullable()
      table
        .integer('reverted_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
    })
  }

  async down() {
    this.schema.alterTable('stock_adjustments', (table) => {
      table.dropForeign(['reverted_by'])
      table.dropColumn('reverted_by')
      table.dropColumn('reverted_at')
    })
  }
}
