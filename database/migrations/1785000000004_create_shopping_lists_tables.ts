import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * The supplier's working shopping list. Suggestions are computed on every view; the list
 * only stores what the supplier changed: the planning settings (horizon, scope, category
 * filter) and per-line overrides, own lines, ticks and dismissed suggestions.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('shopping_lists', (table) => {
      table.increments('id')
      table
        .integer('supplier_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('status', 16).notNullable().defaultTo('active')
      /** Null = plan until the supplier's usual next shopping trip. */
      table.integer('horizon_days').nullable()
      table.string('scope', 16).notNullable().defaultTo('mine')
      table.jsonb('category_ids').notNullable().defaultTo('[]')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
      table.timestamp('completed_at').nullable()

      table.check(`"status" IN ('active', 'done')`)
      table.check(`"scope" IN ('mine', 'all')`)
    })

    this.schema.raw(
      "CREATE UNIQUE INDEX shopping_lists_one_active ON shopping_lists (supplier_id) WHERE status = 'active'"
    )

    this.schema.createTable('shopping_list_items', (table) => {
      table.increments('id')
      table
        .integer('shopping_list_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('shopping_lists')
        .onDelete('CASCADE')
      table.string('kind', 16).notNullable()
      table
        .integer('product_group_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('product_groups')
        .onDelete('CASCADE')
      table
        .integer('product_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('products')
        .onDelete('CASCADE')
      /** Name of an own line that is not in the catalogue. */
      table.string('label', 255).nullable()
      /** Null = take the suggested quantity. */
      table.integer('quantity').nullable()
      table.decimal('unit_cost', 10, 2).nullable()
      table.string('note', 255).nullable()
      table.boolean('is_removed').notNullable().defaultTo(false)
      table.boolean('is_checked').notNullable().defaultTo(false)
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.index(['shopping_list_id'], 'shopping_list_items_list_id_idx')
      table.check(`"kind" IN ('group', 'product', 'custom')`)
    })

    this.schema.raw(
      "CREATE UNIQUE INDEX shopping_list_items_group_unique ON shopping_list_items (shopping_list_id, product_group_id) WHERE kind = 'group'"
    )
    this.schema.raw(
      "CREATE UNIQUE INDEX shopping_list_items_product_unique ON shopping_list_items (shopping_list_id, product_id) WHERE kind = 'product'"
    )
  }

  async down() {
    this.schema.dropTable('shopping_list_items')
    this.schema.dropTable('shopping_lists')
  }
}
