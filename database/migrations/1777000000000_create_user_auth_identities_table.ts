import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_auth_identities'

  async up() {
    await this.db.rawQuery(`
      CREATE TABLE user_auth_identities (
        id serial PRIMARY KEY,
        user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider varchar(255) NOT NULL CHECK ("provider" IN ('microsoft', 'discord')),
        provider_user_id varchar(255) NOT NULL,
        provider_email varchar(255) NULL,
        last_login_at timestamptz NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CONSTRAINT user_auth_identities_provider_provider_user_id_unique UNIQUE (provider, provider_user_id),
        CONSTRAINT user_auth_identities_user_id_provider_unique UNIQUE (user_id, provider)
      )
    `)
    await this.db.rawQuery(
      `CREATE INDEX user_auth_identities_user_id_index ON user_auth_identities (user_id)`
    )

    // Keep existing Microsoft identities from users.oid.
    await this.db.rawQuery(
      `INSERT INTO user_auth_identities (
        user_id, provider, provider_user_id, provider_email, last_login_at, created_at, updated_at
      )
      SELECT id, 'microsoft', oid, email, NOW(), NOW(), NOW()
      FROM users
      WHERE oid IS NOT NULL AND LENGTH(TRIM(oid)) > 0`
    )

    await this.db.rawQuery(`ALTER TABLE users DROP COLUMN oid`)
  }

  async down() {
    await this.db.rawQuery(`ALTER TABLE users ADD COLUMN oid varchar(255) UNIQUE NULL`)

    await this.db.rawQuery(
      `UPDATE users u
       SET oid = i.provider_user_id
       FROM user_auth_identities i
       WHERE i.user_id = u.id AND i.provider = 'microsoft'`
    )

    await this.db.rawQuery(`DROP TABLE user_auth_identities`)
  }
}
