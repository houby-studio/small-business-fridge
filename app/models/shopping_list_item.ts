import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import ShoppingList from '#models/shopping_list'
import Product from '#models/product'
import ProductGroup from '#models/product_group'

export type ShoppingListItemKind = 'group' | 'product' | 'custom'

/**
 * A supplier's change to a line of the shopping list: a quantity or price override, a
 * tick, a dismissed suggestion — or a whole own line (`custom`, or a catalogue product the
 * list did not suggest).
 */
export default class ShoppingListItem extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare shoppingListId: number

  @column()
  declare kind: ShoppingListItemKind

  @column()
  declare productGroupId: number | null

  @column()
  declare productId: number | null

  @column()
  declare label: string | null

  /** Null = the suggested quantity. */
  @column()
  declare quantity: number | null

  @column({ consume: (value: string | null) => (value === null ? null : Number(value)) })
  declare unitCost: number | null

  @column()
  declare note: string | null

  @column()
  declare isRemoved: boolean

  @column()
  declare isChecked: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => ShoppingList)
  declare list: BelongsTo<typeof ShoppingList>

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>

  @belongsTo(() => ProductGroup)
  declare productGroup: BelongsTo<typeof ProductGroup>
}
