import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // Drop the old check constraint first (it rejects 'kiosk')
    await this.db.rawQuery(`
      DO $$
      DECLARE c text;
      BEGIN
        SELECT constraint_name INTO c
        FROM information_schema.table_constraints
        WHERE table_name = 'orders' AND constraint_type = 'CHECK'
        LIMIT 1;
        IF c IS NOT NULL THEN
          EXECUTE 'ALTER TABLE orders DROP CONSTRAINT ' || quote_ident(c);
        END IF;
      END $$
    `)

    // Migrate existing data now that the constraint is gone
    await this.db.rawQuery(`UPDATE orders SET channel = 'kiosk' WHERE channel = 'keypad'`)

    // Add updated check constraint
    await this.db.rawQuery(`
      ALTER TABLE orders ADD CONSTRAINT orders_channel_check
      CHECK (channel IN ('web', 'kiosk', 'scanner'))
    `)
  }

  async down() {
    await this.db.rawQuery(`UPDATE orders SET channel = 'keypad' WHERE channel = 'kiosk'`)

    await this.db.rawQuery(`
      DO $$
      DECLARE c text;
      BEGIN
        SELECT constraint_name INTO c
        FROM information_schema.table_constraints
        WHERE table_name = 'orders' AND constraint_type = 'CHECK'
        LIMIT 1;
        IF c IS NOT NULL THEN
          EXECUTE 'ALTER TABLE orders DROP CONSTRAINT ' || quote_ident(c);
        END IF;
      END $$
    `)

    await this.db.rawQuery(`
      ALTER TABLE orders ADD CONSTRAINT orders_channel_check
      CHECK (channel IN ('web', 'keypad', 'scanner'))
    `)
  }
}
