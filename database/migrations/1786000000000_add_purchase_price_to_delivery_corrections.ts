import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A correction may also fix what the supplier paid for the lot — a mistyped purchase price
 * would otherwise skew their earnings for good. Both snapshots are nullable because older
 * lots (and suppliers who do not track it) have no purchase price at all.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('delivery_corrections', (table) => {
      table.decimal('old_purchase_price', 10, 2).nullable()
      table.decimal('new_purchase_price', 10, 2).nullable()
    })
  }

  async down() {
    this.schema.alterTable('delivery_corrections', (table) => {
      table.dropColumn('new_purchase_price')
      table.dropColumn('old_purchase_price')
    })
  }
}
