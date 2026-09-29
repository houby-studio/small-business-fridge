import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * An order used to read its price live from `deliveries.price`, so any change to a
 * delivery's price silently rewrote the lines of invoices that had already been issued
 * (whose `total_cost` is stored). Snapshotting the unit price on the order lets a supplier
 * correct a mistyped price for purchases that are not invoiced yet, while issued invoices
 * stay exactly as they were.
 */
export default class extends BaseSchema {
  protected tableName = 'orders'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('unit_price').nullable()
    })

    this.defer(async (db) => {
      await db.rawQuery(
        'UPDATE orders SET unit_price = deliveries.price FROM deliveries WHERE deliveries.id = orders.delivery_id'
      )
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.integer('unit_price').notNullable().alter()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('unit_price')
    })
  }
}
