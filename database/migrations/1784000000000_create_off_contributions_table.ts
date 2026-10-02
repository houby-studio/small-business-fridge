import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Contributions to Open Food Facts a supplier agreed to when saving a product: the EAN,
 * the name and, for their own photo, the original and the cut-out. Sent by the scheduler,
 * so saving the product never waits for (or fails on) OFF. The original upload is kept
 * here only until it is sent — it is never served, unlike `storage/uploads`.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('off_contributions', (table) => {
      table.increments('id')
      table
        .integer('product_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('products')
        .onDelete('CASCADE')
      table
        .integer('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.string('barcode', 14).notNullable()
      table.string('product_name', 255).notNullable()
      table.binary('original_image').nullable()
      table.string('original_mime', 64).nullable()
      /** The background-removal choice the supplier saw in the preview. */
      table.string('background', 16).notNullable().defaultTo('auto')
      table.string('status', 16).notNullable().defaultTo('pending')
      table.integer('attempts').notNullable().defaultTo(0)
      table.timestamp('next_attempt_at').notNullable()
      table.text('last_error').nullable()
      /** What OFF got: product created / name sent / uploaded image ids. */
      table.jsonb('result').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
      table.timestamp('completed_at').nullable()

      table.index(['status', 'next_attempt_at'], 'off_contributions_due_idx')
      table.index(['barcode'], 'off_contributions_barcode_idx')
      table.check(`"status" IN ('pending', 'done', 'failed')`)
    })
  }

  async down() {
    this.schema.dropTable('off_contributions')
  }
}
