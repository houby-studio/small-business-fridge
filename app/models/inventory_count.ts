import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import InventoryCountItem from '#models/inventory_count_item'
import StockAdjustment from '#models/stock_adjustment'

/** Which products the sheet offers to count: the actor's own lots, or the whole fridge. */
export type InventoryScope = 'mine' | 'all'

/** A committed inventory: what was counted, and (via adjustments) what it changed. */
export default class InventoryCount extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare actorId: number

  @column()
  declare impersonatorId: number | null

  @column()
  declare scope: InventoryScope

  @column()
  declare note: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => User, { foreignKey: 'actorId' })
  declare actor: BelongsTo<typeof User>

  @hasMany(() => InventoryCountItem)
  declare items: HasMany<typeof InventoryCountItem>

  @hasMany(() => StockAdjustment)
  declare adjustments: HasMany<typeof StockAdjustment>
}
