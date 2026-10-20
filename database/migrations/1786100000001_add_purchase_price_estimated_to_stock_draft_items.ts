import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A draft built from the shopping list carries purchase prices estimated from earlier lots,
 * not read from a receipt. The flag lets the review page mark them and the commit ask once
 * more, so an estimate is not stocked as what the supplier really paid. Typing a price on
 * the line clears it.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('stock_draft_items', (table) => {
      table.boolean('purchase_price_estimated').notNullable().defaultTo(false)
    })
  }

  async down() {
    this.schema.alterTable('stock_draft_items', (table) => {
      table.dropColumn('purchase_price_estimated')
    })
  }
}
