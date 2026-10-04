import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * PostgreSQL does not index foreign keys on its own. The stock overview, the shopping list,
 * the finance report and the warnings before stocking all group or scan `deliveries` by
 * product and date and `orders` by delivery and date — until now with sequential scans.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('deliveries', (table) => {
      table.index(['product_id', 'created_at', 'id'], 'deliveries_product_created_idx')
      table.index(['supplier_id'], 'deliveries_supplier_id_idx')
    })

    this.schema.alterTable('orders', (table) => {
      table.index(['delivery_id'], 'orders_delivery_id_idx')
      table.index(['created_at'], 'orders_created_at_idx')
    })
  }

  async down() {
    this.schema.alterTable('orders', (table) => {
      table.dropIndex(['created_at'], 'orders_created_at_idx')
      table.dropIndex(['delivery_id'], 'orders_delivery_id_idx')
    })

    this.schema.alterTable('deliveries', (table) => {
      table.dropIndex(['supplier_id'], 'deliveries_supplier_id_idx')
      table.dropIndex(['product_id', 'created_at', 'id'], 'deliveries_product_created_idx')
    })
  }
}
