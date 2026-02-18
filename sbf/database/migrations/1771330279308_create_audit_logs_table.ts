import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'audit_logs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.string('action').notNullable()
      table.string('entity_type').notNullable()
      table.integer('entity_id').nullable()
      table
        .integer('target_user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.jsonb('metadata').nullable()

      table.timestamp('created_at').notNullable()

      table.index(['user_id'])
      table.index(['target_user_id'])
      table.index(['entity_type'])
      table.index(['created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
