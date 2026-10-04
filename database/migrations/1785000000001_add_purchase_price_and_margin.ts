import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * What a supplier paid for a lot, next to what customers pay for it (`price`, whole
 * crowns). Both together say what the supplier earns. Nullable: older lots and suppliers
 * who do not track it simply have none.
 *
 * `amount_lost` is the net shrinkage of the lot recorded by write-offs and inventories
 * (negative when an inventory found more pieces than expected), so "sold" stays
 * `amount_supplied - amount_left - amount_lost` without joining the adjustments.
 *
 * `margin_percent` is the supplier's markup, used to suggest a selling price from the
 * purchase price.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('deliveries', (table) => {
      table.decimal('purchase_price', 10, 2).nullable()
      table.integer('amount_lost').notNullable().defaultTo(0)
    })

    this.schema.alterTable('users', (table) => {
      table.decimal('margin_percent', 5, 2).notNullable().defaultTo(0)
    })
  }

  async down() {
    this.schema.alterTable('users', (table) => {
      table.dropColumn('margin_percent')
    })
    this.schema.alterTable('deliveries', (table) => {
      table.dropColumn('amount_lost')
      table.dropColumn('purchase_price')
    })
  }
}
