import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Bulk stocking drafts ("návrhy naskladnění"): lines prepared by an AI assistant over MCP
 * (typically read from a receipt), by a finished shopping list or by hand. Nothing is
 * stocked until the supplier reviews the lines on the web and commits the whole draft.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('stock_drafts', (table) => {
      table.increments('id')
      table
        .integer('supplier_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('source', 16).notNullable()
      table.string('note', 500).nullable()
      table.string('status', 16).notNullable().defaultTo('open')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
      table.timestamp('committed_at').nullable()

      table.index(['supplier_id', 'status'], 'stock_drafts_supplier_status_idx')
      table.check(`"source" IN ('web', 'mcp', 'shopping_list')`)
      table.check(`"status" IN ('open', 'committed', 'discarded')`)
    })

    this.schema.createTable('stock_draft_items', (table) => {
      table.increments('id')
      table
        .integer('stock_draft_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('stock_drafts')
        .onDelete('CASCADE')
      /** Null until the supplier picks the product (an unmatched receipt line). */
      table
        .integer('product_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('products')
        .onDelete('SET NULL')
      /** A shopping-list group line — narrows the product picker to the group. */
      table
        .integer('product_group_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('product_groups')
        .onDelete('SET NULL')
      /** The line as the source named it, e.g. the text on the receipt. */
      table.string('label', 255).nullable()
      table.integer('amount').notNullable()
      table.decimal('purchase_price', 10, 2).nullable()
      table.integer('price').nullable()
      table.integer('sort_order').notNullable().defaultTo(0)
      /** The lot this line became once the draft was committed. */
      table
        .integer('delivery_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('deliveries')
        .onDelete('SET NULL')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.index(['stock_draft_id'], 'stock_draft_items_draft_id_idx')
    })
  }

  async down() {
    this.schema.dropTable('stock_draft_items')
    this.schema.dropTable('stock_drafts')
  }
}
