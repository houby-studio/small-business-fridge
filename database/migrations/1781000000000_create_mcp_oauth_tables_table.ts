import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('mcp_oauth_clients', (table) => {
      table.string('client_id').primary()
      table.string('client_name').notNullable()
      table.text('redirect_uris').notNullable() // JSON array
      table.text('grant_types').notNullable().defaultTo('["authorization_code"]') // JSON array
      table.timestamp('created_at').notNullable()
    })

    this.schema.createTable('mcp_oauth_codes', (table) => {
      table.string('code').primary()
      table
        .string('client_id')
        .notNullable()
        .references('client_id')
        .inTable('mcp_oauth_clients')
        .onDelete('CASCADE')
      table
        .bigInteger('user_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('redirect_uri').notNullable()
      table.string('code_challenge').notNullable() // SHA-256 base64url of code_verifier
      table.boolean('used').notNullable().defaultTo(false)
      table.timestamp('expires_at').notNullable()
      table.timestamp('created_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable('mcp_oauth_codes')
    this.schema.dropTable('mcp_oauth_clients')
  }
}
