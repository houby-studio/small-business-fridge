import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Purchase groups ("nákupní skupiny"): products a supplier buys interchangeably, such as
 * "energy drink with sugar" or "chocolate bars". The shopping list plans a group as one
 * line — any flavour will do — and lists the products of the group only as hints.
 * Customers never see groups; the shop keeps using categories.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('product_groups', (table) => {
      table.increments('id')
      table.string('name', 100).notNullable()
      table
        .integer('category_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('categories')
        .onDelete('CASCADE')
      table.string('note', 500).nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.index(['category_id'], 'product_groups_category_id_idx')
    })

    this.schema.raw(
      'CREATE UNIQUE INDEX product_groups_name_unique ON product_groups (LOWER(name))'
    )

    this.schema.alterTable('products', (table) => {
      table
        .integer('product_group_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('product_groups')
        .onDelete('SET NULL')
      table.index(['product_group_id'], 'products_product_group_id_idx')
    })
  }

  async down() {
    this.schema.alterTable('products', (table) => {
      table.dropIndex(['product_group_id'], 'products_product_group_id_idx')
      table.dropColumn('product_group_id')
    })
    this.schema.dropTable('product_groups')
  }
}
