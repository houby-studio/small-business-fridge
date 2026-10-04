import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import StockDraftItem from '#models/stock_draft_item'

export type StockDraftSource = 'web' | 'mcp' | 'shopping_list'
export type StockDraftStatus = 'open' | 'committed' | 'discarded'

/** A bulk stocking prepared ahead (e.g. read from a receipt) and committed after review. */
export default class StockDraft extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare supplierId: number

  @column()
  declare source: StockDraftSource

  @column()
  declare note: string | null

  @column()
  declare status: StockDraftStatus

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @column.dateTime()
  declare committedAt: DateTime | null

  @belongsTo(() => User, { foreignKey: 'supplierId' })
  declare supplier: BelongsTo<typeof User>

  @hasMany(() => StockDraftItem)
  declare items: HasMany<typeof StockDraftItem>
}
