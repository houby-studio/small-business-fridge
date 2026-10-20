import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { mergeOpenDrafts } from '#database/migrations/1786100000902_one_open_stock_draft_per_supplier'

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

test.group('Migration: one open stocking draft per supplier', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('open drafts merge into the newest one, lines keep order and source', async ({ assert }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const other = await UserFactory.apply('supplier').create()
    const category = await CategoryFactory.create()
    const product = await ProductFactory.merge({ categoryId: category.id }).create()

    const trx = await db.transaction()
    try {
      // The state before the migration: several open drafts were allowed.
      await trx.rawQuery('DROP INDEX stock_drafts_one_open_per_supplier')
      const draft = async (supplierId: number, source: string, note: string, age: number) => {
        const at = new Date(Date.now() - age * 3_600_000)
        const [row] = await trx
          .table('stock_drafts')
          .insert({
            supplier_id: supplierId,
            source,
            note,
            status: 'open',
            created_at: at,
            updated_at: at,
          })
          .returning('id')
        return Number(row.id ?? row)
      }
      const line = async (draftId: number, source: string, amount: number, sortOrder: number) =>
        trx.table('stock_draft_items').insert({
          stock_draft_id: draftId,
          product_id: product.id,
          amount,
          price: 10,
          source,
          sort_order: sortOrder,
          created_at: new Date(),
          updated_at: new Date(),
        })

      const oldest = await draft(supplier.id, 'web', 'ručně', 48)
      const middle = await draft(supplier.id, 'shopping_list', 'seznam', 24)
      const newest = await draft(supplier.id, 'mcp', 'účtenka', 1)
      const theirs = await draft(other.id, 'web', 'kolega', 5)
      await line(oldest, 'web', 1, 0)
      await line(oldest, 'web', 2, 1)
      await line(middle, 'shopping_list', 3, 0)
      await line(newest, 'assistant', 4, 0)
      await line(theirs, 'web', 9, 0)

      await mergeOpenDrafts(trx)

      const drafts = await trx.from('stock_drafts').orderBy('id').select('id', 'status', 'note')
      assert.deepEqual(
        drafts.map((d) => [Number(d.id), d.status]),
        [
          [oldest, 'discarded'],
          [middle, 'discarded'],
          [newest, 'open'],
          [theirs, 'open'],
        ]
      )
      assert.equal(drafts.find((d) => Number(d.id) === newest)!.note, 'účtenka · ručně · seznam')
      const lines = await trx
        .from('stock_draft_items')
        .where('stock_draft_id', newest)
        .orderBy('sort_order')
        .select('amount', 'source', 'sort_order')
      assert.deepEqual(
        lines.map((l) => [l.amount, l.source, l.sort_order]),
        [
          [4, 'assistant', 0],
          [1, 'web', 1],
          [2, 'web', 2],
          [3, 'shopping_list', 3],
        ]
      )
      // The colleague's draft is theirs: untouched.
      const theirLines = await trx.from('stock_draft_items').where('stock_draft_id', theirs)
      assert.lengthOf(theirLines, 1)
    } finally {
      // Rolls the index drop back as well.
      await trx.rollback()
    }
  })
})
