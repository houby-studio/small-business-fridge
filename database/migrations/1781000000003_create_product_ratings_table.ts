import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('product_ratings', (table) => {
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
      table.integer('stars').notNullable()
      table.text('comment').nullable()
      table.string('visibility').notNullable().defaultTo('public')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.unique(['user_id', 'product_id'], 'product_ratings_user_product_unique_idx')
      table.index(['product_id'], 'product_ratings_product_id_idx')
      table.index(['user_id'], 'product_ratings_user_id_idx')
      table.index(['created_at'], 'product_ratings_created_at_idx')

      table.check(`"stars" >= 1 AND "stars" <= 5`)
      table.check(`"visibility" IN ('public', 'private')`)
    })
  }

  async down() {
    this.schema.dropTable('product_ratings')
  }
}
