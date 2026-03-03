import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'email_verification_tokens'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE')
      table.string('email').notNullable()
      table.string('token_hash').notNullable().unique()
      table.timestamp('expires_at').notNullable()
      table.timestamp('used_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.index(['user_id'], 'email_verification_tokens_user_id_idx')
      table.index(['email'], 'email_verification_tokens_email_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
