import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_invitations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('email').notNullable()
      table.string('role').notNullable().defaultTo('customer')
      table.string('token_hash').notNullable().unique()
      table
        .integer('invited_by_user_id')
        .unsigned()
        .nullable()
        .references('users.id')
        .onDelete('SET NULL')
      table
        .integer('accepted_user_id')
        .unsigned()
        .nullable()
        .references('users.id')
        .onDelete('SET NULL')
      table.timestamp('expires_at').notNullable()
      table.timestamp('accepted_at').nullable()
      table.timestamp('revoked_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.check(`"role" IN ('customer', 'supplier', 'admin')`)
      table.index(['email'], 'user_invitations_email_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
