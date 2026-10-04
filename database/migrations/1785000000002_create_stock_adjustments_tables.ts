import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Shrinkage ("manko"): pieces that left the fridge without a sale, and the occasional
 * surplus an inventory finds. An inventory records what was counted per product; every
 * change it makes to a lot, like every manual write-off, is one `stock_adjustments` row
 * with the lot's prices snapshotted, so losses can be valued at purchase and selling price.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('inventory_counts', (table) => {
      table.increments('id')
      table
        .integer('actor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      /** The admin really behind the count when they acted while impersonating the actor. */
      table
        .integer('impersonator_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.string('scope', 16).notNullable()
      table.text('note').nullable()
      table.timestamp('created_at').notNullable()

      table.index(['created_at'], 'inventory_counts_created_at_idx')
      table.check(`"scope" IN ('mine', 'all')`)
    })

    this.schema.createTable('inventory_count_items', (table) => {
      table.increments('id')
      table
        .integer('inventory_count_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('inventory_counts')
        .onDelete('CASCADE')
      table
        .integer('product_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('products')
        .onDelete('CASCADE')
      /** System stock the counter saw when they counted the product. */
      table.integer('expected_qty').notNullable()
      table.integer('counted_qty').notNullable()
      /** What was actually written off (negative) or added back (positive). */
      table.integer('applied_qty').notNullable()

      // One row per product and count; the index also serves lookups by count.
      table.unique(
        ['inventory_count_id', 'product_id'],
        'inventory_count_items_count_product_unique'
      )
    })

    this.schema.createTable('stock_adjustments', (table) => {
      table.increments('id')
      table
        .integer('delivery_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('deliveries')
        .onDelete('CASCADE')
      table
        .integer('product_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('products')
        .onDelete('CASCADE')
      /** Owner of the lot — whose money the loss is. */
      table
        .integer('supplier_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table
        .integer('actor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table
        .integer('impersonator_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.string('kind', 16).notNullable()
      table.string('reason', 16).notNullable()
      table.integer('quantity').notNullable()
      table.decimal('unit_cost', 10, 2).nullable()
      table.integer('unit_price').notNullable()
      table
        .integer('inventory_count_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('inventory_counts')
        .onDelete('SET NULL')
      table.text('note').nullable()
      table.timestamp('created_at').notNullable()

      table.index(['supplier_id', 'created_at'], 'stock_adjustments_supplier_created_idx')
      table.index(['product_id'], 'stock_adjustments_product_id_idx')
      table.index(['inventory_count_id'], 'stock_adjustments_inventory_count_id_idx')
      table.check(`"kind" IN ('loss', 'surplus')`)
      table.check(`"reason" IN ('inventory', 'damaged', 'expired', 'stolen', 'other')`)
      table.check(`"quantity" > 0`)
    })
  }

  async down() {
    this.schema.dropTable('stock_adjustments')
    this.schema.dropTable('inventory_count_items')
    this.schema.dropTable('inventory_counts')
  }
}
