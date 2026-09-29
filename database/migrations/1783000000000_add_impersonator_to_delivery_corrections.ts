import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A correction made by an admin while impersonating the supplier is recorded as the
 * supplier's (they are the effective user). Keep the real admin too, so the buyers' emails
 * and the supplier's notice name who actually changed the delivery.
 */
export default class extends BaseSchema {
  protected tableName = 'delivery_corrections'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table
        .integer('impersonator_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('impersonator_id')
    })
  }
}
