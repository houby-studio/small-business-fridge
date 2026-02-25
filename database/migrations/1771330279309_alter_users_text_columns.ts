import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.text('oid').alter()
      table.text('display_name').alter()
      table.text('email').alter()
      table.text('card_id').alter()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('oid').alter()
      table.string('display_name').alter()
      table.string('email').alter()
      table.string('card_id').alter()
    })
  }
}
