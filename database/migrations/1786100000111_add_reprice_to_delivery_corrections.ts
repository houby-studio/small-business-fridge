import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A supplier can change the selling price of the pieces still in stock ("Změnit cenu") —
 * a sale or a price rise, unlike a correction it never touches what was already sold.
 * Every lot it changes keeps a `reprice` record with the old and the new price.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      ALTER TABLE delivery_corrections DROP CONSTRAINT IF EXISTS delivery_corrections_kind_check;
      ALTER TABLE delivery_corrections ADD CONSTRAINT delivery_corrections_kind_check
        CHECK (kind IN ('update', 'void', 'reprice'));
    `)
  }

  async down() {
    this.schema.raw(`
      DELETE FROM delivery_corrections WHERE kind = 'reprice';
      ALTER TABLE delivery_corrections DROP CONSTRAINT IF EXISTS delivery_corrections_kind_check;
      ALTER TABLE delivery_corrections ADD CONSTRAINT delivery_corrections_kind_check
        CHECK (kind IN ('update', 'void'));
    `)
  }
}
