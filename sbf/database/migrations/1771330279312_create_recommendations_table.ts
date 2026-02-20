import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'recommendations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table
        .integer('product_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('products')
        .onDelete('CASCADE')
      table.float('score').notNullable()
      table.string('model').notNullable()
      table.integer('rank').notNullable()
      table.timestamp('generated_at').notNullable()

      table.timestamp('created_at').notNullable()

      table.unique(['user_id', 'product_id', 'model'])
      table.index(['user_id', 'model', 'rank'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
