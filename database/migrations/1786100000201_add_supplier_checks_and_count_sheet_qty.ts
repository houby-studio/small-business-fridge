import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Database guards for what the services already promise, so a bug or a hand-written
 * query cannot store an impossible row:
 *
 * - CHECK constraints on the supplier tables (draft lines, list lines, counts, margin,
 *   horizon, the draft's committed state).
 * - A purchase group no longer disappears with its category: deleting a category that
 *   still has groups is refused (the admin is told to move or delete the groups first).
 * - `inventory_count_items.sheet_qty`: the stock the inventory sheet showed, when the
 *   count was compared with a different one — sales, deliveries and other counts between
 *   loading the sheet and counting the product move the expected stock.
 * - An index for the default "my inventories" history.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('inventory_count_items', (table) => {
      table.integer('sheet_qty').nullable()
    })
    this.schema.alterTable('inventory_counts', (table) => {
      table.index(['actor_id', 'created_at'], 'inventory_counts_actor_created_idx')
    })

    this.schema.alterTable('product_groups', (table) => {
      table.dropForeign(['category_id'])
    })
    this.schema.alterTable('product_groups', (table) => {
      table.foreign('category_id').references('id').inTable('categories').onDelete('RESTRICT')
    })

    for (const [tableName, name, check] of CHECKS) {
      this.schema.raw(`ALTER TABLE ${tableName} ADD CONSTRAINT ${name} CHECK (${check})`)
    }
  }

  async down() {
    for (const [tableName, name] of [...CHECKS].reverse()) {
      this.schema.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${name}`)
    }

    this.schema.alterTable('product_groups', (table) => {
      table.dropForeign(['category_id'])
    })
    this.schema.alterTable('product_groups', (table) => {
      table.foreign('category_id').references('id').inTable('categories').onDelete('CASCADE')
    })

    this.schema.alterTable('inventory_counts', (table) => {
      table.dropIndex(['actor_id', 'created_at'], 'inventory_counts_actor_created_idx')
    })
    this.schema.alterTable('inventory_count_items', (table) => {
      table.dropColumn('sheet_qty')
    })
  }
}

const CHECKS: Array<[table: string, name: string, check: string]> = [
  ['stock_draft_items', 'stock_draft_items_amount_check', 'amount > 0'],
  ['stock_draft_items', 'stock_draft_items_price_check', 'price IS NULL OR price >= 1'],
  [
    'stock_draft_items',
    'stock_draft_items_purchase_price_check',
    'purchase_price IS NULL OR purchase_price >= 0',
  ],
  [
    'stock_drafts',
    'stock_drafts_committed_at_check',
    "(status = 'committed') = (committed_at IS NOT NULL)",
  ],
  [
    'shopping_list_items',
    'shopping_list_items_quantity_check',
    'quantity IS NULL OR quantity >= 0',
  ],
  [
    'shopping_list_items',
    'shopping_list_items_unit_cost_check',
    'unit_cost IS NULL OR unit_cost >= 0',
  ],
  [
    'shopping_list_items',
    'shopping_list_items_kind_refs_check',
    "(kind = 'group' AND product_group_id IS NOT NULL AND product_id IS NULL)" +
      " OR (kind = 'product' AND product_id IS NOT NULL AND product_group_id IS NULL)" +
      " OR (kind = 'custom' AND product_id IS NULL AND product_group_id IS NULL)",
  ],
  [
    'shopping_lists',
    'shopping_lists_horizon_days_check',
    'horizon_days IS NULL OR horizon_days BETWEEN 1 AND 60',
  ],
  [
    'inventory_count_items',
    'inventory_count_items_qty_check',
    'expected_qty >= 0 AND counted_qty >= 0 AND (sheet_qty IS NULL OR sheet_qty >= 0)',
  ],
  ['users', 'users_margin_percent_check', 'margin_percent BETWEEN 0 AND 100'],
]
