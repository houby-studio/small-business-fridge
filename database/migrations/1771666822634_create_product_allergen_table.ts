import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'product_allergen'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('product_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('products')
        .onDelete('CASCADE')
      table
        .integer('allergen_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('allergens')
        .onDelete('CASCADE')

      table.unique(['product_id', 'allergen_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
