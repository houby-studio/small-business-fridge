import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // Drop the old channel check first (it rejects 'kiosk')
    await this.db.rawQuery(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_channel_check`)

    // Migrate existing data now that the constraint is gone
    await this.db.rawQuery(`UPDATE orders SET channel = 'kiosk' WHERE channel = 'keypad'`)

    // Add updated check constraint
    await this.db.rawQuery(`
      ALTER TABLE orders ADD CONSTRAINT orders_channel_check
      CHECK (channel IN ('web', 'kiosk', 'scanner'))
    `)
  }

  async down() {
    await this.db.rawQuery(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_channel_check`)

    // Convert data only after dropping the current constraint (which rejects 'keypad')
    await this.db.rawQuery(`UPDATE orders SET channel = 'keypad' WHERE channel = 'kiosk'`)

    await this.db.rawQuery(`
      ALTER TABLE orders ADD CONSTRAINT orders_channel_check
      CHECK (channel IN ('web', 'keypad', 'scanner'))
    `)
  }
}
