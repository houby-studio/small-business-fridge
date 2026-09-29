import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * History of corrections a supplier (or admin) made to a delivery after it was stocked:
 * a changed amount or price, or a void of a delivery nothing was sold from. The delivery
 * row itself only holds the current values, so this is where the original ones live.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('delivery_corrections', (table) => {
      table.increments('id')
      table
        .integer('delivery_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('deliveries')
        .onDelete('CASCADE')
      table
        .integer('actor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT')
      table.string('kind').notNullable()
      table.text('reason').notNullable()
      table.integer('old_amount_supplied').notNullable()
      table.integer('new_amount_supplied').notNullable()
      table.integer('old_price').notNullable()
      table.integer('new_price').notNullable()
      table.integer('repriced_order_count').notNullable().defaultTo(0)
      table.timestamp('created_at').notNullable()

      table.index(['delivery_id'], 'delivery_corrections_delivery_id_idx')
      table.check(`"kind" IN ('update', 'void')`)
    })

    this.schema.alterTable('deliveries', (table) => {
      table.timestamp('voided_at').nullable()
    })

    this.schema.alterTable('orders', (table) => {
      table.integer('original_unit_price').nullable()
      table
        .integer('price_correction_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('delivery_corrections')
        .onDelete('SET NULL')
    })
  }

  async down() {
    this.schema.alterTable('orders', (table) => {
      table.dropColumn('price_correction_id')
      table.dropColumn('original_unit_price')
    })
    this.schema.alterTable('deliveries', (table) => {
      table.dropColumn('voided_at')
    })
    this.schema.dropTable('delivery_corrections')
  }
}
