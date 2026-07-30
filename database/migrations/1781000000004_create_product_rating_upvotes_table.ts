import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('product_rating_upvotes', (table) => {
      table.increments('id')
      table
        .integer('product_rating_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('product_ratings')
        .onDelete('CASCADE')
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.unique(['product_rating_id', 'user_id'], 'product_rating_upvotes_unique_idx')
      table.index(['product_rating_id'], 'product_rating_upvotes_rating_id_idx')
    })
  }

  async down() {
    this.schema.dropTable('product_rating_upvotes')
  }
}
