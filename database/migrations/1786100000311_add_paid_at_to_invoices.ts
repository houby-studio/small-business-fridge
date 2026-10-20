import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * `invoices.paid_at` — when the money for an invoice arrived. The yearly income limit counts
 * what a supplier was paid in a year, not what was bought, so it needs the payment date.
 *
 * Backfill for invoices already paid: the newest `payment.approved` audit entry of the
 * invoice, else its last update. A self-invoice (the supplier's own purchases) is paid the
 * moment it is issued.
 */
/** Exported for the backfill test. */
export const BACKFILL_PAID_AT_SQL = `
  UPDATE invoices
     SET paid_at = CASE
           WHEN buyer_id = supplier_id THEN created_at
           ELSE COALESCE(
             (SELECT MAX(audit_logs.created_at)
                FROM audit_logs
               WHERE audit_logs.action = 'payment.approved'
                 AND audit_logs.entity_type = 'invoice'
                 AND audit_logs.entity_id = invoices.id),
             updated_at
           )
         END
   WHERE is_paid = true AND paid_at IS NULL
`

export default class extends BaseSchema {
  protected tableName = 'invoices'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('paid_at', { useTz: true }).nullable()
    })

    this.defer(async (db) => {
      await db.rawQuery(BACKFILL_PAID_AT_SQL)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('paid_at')
    })
  }
}
