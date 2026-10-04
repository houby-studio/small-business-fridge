import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import ShoppingListItem from '#models/shopping_list_item'

export type ShoppingListScope = 'mine' | 'all'

/** A supplier's working shopping list: planning settings plus their changes to it. */
export default class ShoppingList extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare supplierId: number

  @column()
  declare status: 'active' | 'done'

  /** Null = until the supplier's usual next shopping trip. */
  @column()
  declare horizonDays: number | null

  @column()
  declare scope: ShoppingListScope

  @column({
    prepare: (value: number[]) => JSON.stringify(value ?? []),
    consume: (value: unknown) =>
      (Array.isArray(value) ? value : []).map(Number).filter((n) => Number.isInteger(n)),
  })
  declare categoryIds: number[]

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @column.dateTime()
  declare completedAt: DateTime | null

  @belongsTo(() => User, { foreignKey: 'supplierId' })
  declare supplier: BelongsTo<typeof User>

  @hasMany(() => ShoppingListItem)
  declare items: HasMany<typeof ShoppingListItem>
}
