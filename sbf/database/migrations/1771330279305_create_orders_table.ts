import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'orders'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('buyer_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT')
      table
        .integer('delivery_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('deliveries')
        .onDelete('RESTRICT')
      table
        .integer('invoice_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('invoices')
        .onDelete('SET NULL')
      table.string('channel').notNullable().defaultTo('web')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.check(`"channel" IN ('web', 'keypad', 'scanner')`)
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
