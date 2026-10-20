import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A product nobody stocks any more can be archived: it leaves the shop, the kiosk, the
 * recommendations and every supplier picker, but its history (orders, deliveries,
 * invoices) stays intact. Stocking it again brings it back on its own.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('products', (table) => {
      table.timestamp('archived_at', { useTz: true }).nullable()
    })
  }

  async down() {
    this.schema.alterTable('products', (table) => {
      table.dropColumn('archived_at')
    })
  }
}
