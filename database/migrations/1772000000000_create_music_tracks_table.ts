import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'music_tracks'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('name').notNullable()
      table.string('file_path').notNullable()
      table.string('mime_type').notNullable()
      table.string('access_level').notNullable().defaultTo('public')
      table.boolean('is_disabled').notNullable().defaultTo(false)
      table
        .integer('uploaded_by_user_id')
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
        .nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.check(`"access_level" IN ('public', 'premium')`)
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
