import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('mcp_eval_runs', (table) => {
      table.increments('id')
      table.string('model_id', 100).notNullable()
      table.string('model_label', 100).nullable()
      table.string('status', 20).notNullable().defaultTo('running')
      table.timestamp('started_at').notNullable()
      table.timestamp('finished_at').nullable()
      table.integer('pass_count').notNullable().defaultTo(0)
      table.integer('fail_count').notNullable().defaultTo(0)
      table.integer('error_count').notNullable().defaultTo(0)
      table.integer('total_count').notNullable().defaultTo(0)
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })

    this.schema.createTable('mcp_eval_results', (table) => {
      table.increments('id')
      table.integer('run_id').unsigned().references('id').inTable('mcp_eval_runs').notNullable()
      table.string('scenario_id', 100).notNullable()
      table.text('scenario_description').notNullable()
      table.boolean('passed').notNullable()
      table.string('tool_called', 100).nullable()
      table.jsonb('tool_input').nullable()
      table.string('expected_tool', 100).notNullable()
      table.text('failure_reason').nullable()
      table.integer('duration_ms').notNullable().defaultTo(0)
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTableIfExists('mcp_eval_results')
    this.schema.dropTableIfExists('mcp_eval_runs')
  }
}
