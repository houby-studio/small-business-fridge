import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_excluded_allergen'

  async up() {
    await this.db.rawQuery(`
      CREATE TABLE user_excluded_allergen (
        user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        allergen_id integer NOT NULL REFERENCES allergens(id) ON DELETE CASCADE,
        CONSTRAINT user_excluded_allergen_user_id_allergen_id_unique UNIQUE (user_id, allergen_id)
      )
    `)

    await this.db.rawQuery(
      `CREATE INDEX user_excluded_allergen_user_id_index ON user_excluded_allergen (user_id)`
    )
    await this.db.rawQuery(
      `CREATE INDEX user_excluded_allergen_allergen_id_index ON user_excluded_allergen (allergen_id)`
    )

    await this.db.rawQuery(`
      INSERT INTO user_excluded_allergen (user_id, allergen_id)
      SELECT u.id, (jsonb_array_elements_text(u.excluded_allergen_ids))::int
      FROM users u
      WHERE jsonb_typeof(u.excluded_allergen_ids) = 'array'
      ON CONFLICT (user_id, allergen_id) DO NOTHING
    `)

    await this.db.rawQuery(`ALTER TABLE users DROP COLUMN excluded_allergen_ids`)
  }

  async down() {
    await this.db.rawQuery(
      `ALTER TABLE users ADD COLUMN excluded_allergen_ids jsonb NOT NULL DEFAULT '[]'::jsonb`
    )

    await this.db.rawQuery(`
      UPDATE users u
      SET excluded_allergen_ids = COALESCE(s.ids, '[]'::jsonb)
      FROM (
        SELECT user_id, jsonb_agg(allergen_id ORDER BY allergen_id) AS ids
        FROM user_excluded_allergen
        GROUP BY user_id
      ) s
      WHERE s.user_id = u.id
    `)

    await this.db.rawQuery(`DROP TABLE user_excluded_allergen`)
  }
}
