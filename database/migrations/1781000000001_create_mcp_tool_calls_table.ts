import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'mcp_tool_calls'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')
      table
        .bigInteger('user_id')
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
        .nullable()
      table.string('tool_name', 100).notNullable()
      table.jsonb('tool_arguments').nullable()
      table.boolean('success').notNullable().defaultTo(true)
      table.text('error_message').nullable()
      table.integer('duration_ms').nullable()
      table.text('user_agent').nullable()
      table.string('ms_correlation_id', 255).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()

      table.index(['user_id'])
      table.index(['tool_name'])
      table.index(['success'])
      table.index(['created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
