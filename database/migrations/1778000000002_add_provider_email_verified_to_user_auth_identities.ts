import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_auth_identities'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('provider_email_verified').notNullable().defaultTo(false)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('provider_email_verified')
    })
  }
}
