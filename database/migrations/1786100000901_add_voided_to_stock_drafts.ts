import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A stocked draft can be voided as a whole (a duplicate receipt, the wrong fridge) while
 * none of its lots has sold or lost a piece: every lot is voided and the draft becomes
 * `voided`, keeping when it was stocked. One reason covers all of its lots.
 *
 * Runs after 1786100000201, which created `stock_drafts_committed_at_check`.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('stock_drafts', (table) => {
      table.timestamp('voided_at').nullable()
      table.string('void_reason', 500).nullable()
      table.dropChecks(['stock_drafts_status_check', 'stock_drafts_committed_at_check'])
    })
    this.schema.alterTable('stock_drafts', (table) => {
      table.check(
        `"status" IN ('open', 'committed', 'discarded', 'voided')`,
        [],
        'stock_drafts_status_check'
      )
      table.check(
        `("status" IN ('committed', 'voided')) = ("committed_at" IS NOT NULL)`,
        [],
        'stock_drafts_committed_at_check'
      )
      table.check(
        `("status" = 'voided') = ("voided_at" IS NOT NULL)`,
        [],
        'stock_drafts_voided_at_check'
      )
      // The 30-day history of stocked drafts.
      table.index(['supplier_id', 'committed_at'], 'stock_drafts_supplier_committed_idx')
    })
  }

  async down() {
    this.schema.alterTable('stock_drafts', (table) => {
      table.dropIndex(['supplier_id', 'committed_at'], 'stock_drafts_supplier_committed_idx')
      table.dropChecks([
        'stock_drafts_voided_at_check',
        'stock_drafts_committed_at_check',
        'stock_drafts_status_check',
      ])
    })
    this.defer(async (db) => {
      await db.from('stock_drafts').where('status', 'voided').update({ status: 'committed' })
    })
    this.schema.alterTable('stock_drafts', (table) => {
      table.dropColumn('void_reason')
      table.dropColumn('voided_at')
      table.check(`"status" IN ('open', 'committed', 'discarded')`, [], 'stock_drafts_status_check')
      table.check(
        `("status" = 'committed') = ("committed_at" IS NOT NULL)`,
        [],
        'stock_drafts_committed_at_check'
      )
    })
  }
}
