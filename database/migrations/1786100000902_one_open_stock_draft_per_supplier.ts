import { BaseSchema } from '@adonisjs/lucid/schema'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * One open stocking draft per supplier. "Stock" on the web, a finished shopping list and an
 * AI assistant all add lines to the same draft, so the source moves onto each line
 * (`stock_draft_items.source`: web, shopping_list or assistant); `stock_drafts.source` keeps
 * only what started the draft.
 *
 * Suppliers who have several open drafts get them merged into their newest one: the lines of
 * the others move over (after its own lines, keeping their order and their source) and the
 * emptied drafts are discarded. A partial unique index then keeps it that way. The merge is
 * not undone by `down()` — the moved lines stay where they are.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('stock_draft_items', (table) => {
      table.string('source', 16).notNullable().defaultTo('web')
      table.check(
        `"source" IN ('web', 'shopping_list', 'assistant')`,
        [],
        'stock_draft_items_source_check'
      )
    })

    this.defer(async (db) => {
      await db.rawQuery(`
        UPDATE stock_draft_items i
           SET source = CASE d.source WHEN 'mcp' THEN 'assistant' ELSE d.source END
          FROM stock_drafts d
         WHERE d.id = i.stock_draft_id
      `)

      await mergeOpenDrafts(db)
    })

    this.schema.raw(
      `CREATE UNIQUE INDEX stock_drafts_one_open_per_supplier ON stock_drafts (supplier_id) WHERE status = 'open'`
    )
  }

  async down() {
    this.schema.raw('DROP INDEX IF EXISTS stock_drafts_one_open_per_supplier')
    this.schema.alterTable('stock_draft_items', (table) => {
      table.dropChecks(['stock_draft_items_source_check'])
      table.dropColumn('source')
    })
  }
}

/**
 * Merges each supplier's open drafts into their newest one (exported for its test).
 */
export async function mergeOpenDrafts(db: QueryClientContract) {
  const open = await db
    .from('stock_drafts')
    .where('status', 'open')
    .orderBy('supplier_id')
    .orderBy('updated_at', 'desc')
    .orderBy('id', 'desc')
    .select('id', 'supplier_id', 'note')
  const bySupplier = new Map<number, Array<{ id: number; note: string | null }>>()
  for (const row of open) {
    const list = bySupplier.get(Number(row.supplier_id)) ?? []
    list.push({ id: Number(row.id), note: row.note })
    bySupplier.set(Number(row.supplier_id), list)
  }

  for (const [, drafts] of bySupplier) {
    if (drafts.length < 2) continue
    const [keeper, ...others] = drafts
    const last = await db
      .from('stock_draft_items')
      .where('stock_draft_id', keeper.id)
      .max('sort_order as max')
      .first()
    let next = last?.max === null || last?.max === undefined ? 0 : Number(last.max) + 1
    // Oldest first, so the lines read in the order they were prepared.
    const oldestFirst = [...others].reverse()
    for (const other of oldestFirst) {
      const lines = await db
        .from('stock_draft_items')
        .where('stock_draft_id', other.id)
        .orderBy('sort_order')
        .orderBy('id')
        .select('id')
      for (const line of lines) {
        await db
          .from('stock_draft_items')
          .where('id', line.id)
          .update({ stock_draft_id: keeper.id, sort_order: next++ })
      }
    }
    const notes = [keeper, ...oldestFirst]
      .map((draft) => draft.note?.trim())
      .filter((note): note is string => !!note)
    const now = new Date()
    await db
      .from('stock_drafts')
      .where('id', keeper.id)
      .update({ note: [...new Set(notes)].join(' · ').slice(0, 500) || null, updated_at: now })
    await db
      .from('stock_drafts')
      .whereIn(
        'id',
        others.map((draft) => draft.id)
      )
      .update({ status: 'discarded', updated_at: now })
  }
}
