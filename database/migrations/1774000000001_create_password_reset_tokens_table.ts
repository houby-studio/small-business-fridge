import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'password_reset_tokens'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('email').notNullable()
      table.string('token_hash').notNullable().unique()
      table.timestamp('expires_at').notNullable()
      table.timestamp('used_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.index(['email'], 'password_reset_tokens_email_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
