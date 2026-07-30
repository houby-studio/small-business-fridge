import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'profile_pending_drafts'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('user_id').unsigned().notNullable()
      table.string('draft_key', 64).notNullable().unique()
      table.jsonb('payload').notNullable()
      table.timestamp('expires_at').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.foreign('user_id').references('users.id').onDelete('CASCADE')
      table.index(['user_id'])
      table.index(['expires_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
