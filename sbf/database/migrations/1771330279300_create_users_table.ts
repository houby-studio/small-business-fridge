import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('oid').unique().nullable()
      table.string('username').unique().nullable()
      table.string('password').nullable()
      table.string('display_name').notNullable()
      table.string('email').notNullable()
      table.string('phone').nullable()
      table.string('iban', 24).nullable()
      table.integer('keypad_id').unique().notNullable()
      table.string('card_id').unique().nullable()
      table.string('role').notNullable().defaultTo('customer')
      table.boolean('is_kiosk').defaultTo(false)
      table.boolean('is_disabled').defaultTo(false)
      table.boolean('show_all_products').defaultTo(false)
      table.boolean('send_mail_on_purchase').defaultTo(true)
      table.boolean('send_daily_report').defaultTo(true)
      table.string('color_mode').defaultTo('dark')
      table.boolean('keypad_disabled').defaultTo(false)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.check(`"role" IN ('customer', 'supplier', 'admin')`)
      table.check(`"color_mode" IN ('light', 'dark')`)
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
