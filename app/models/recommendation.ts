import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Product from '#models/product'

export default class Recommendation extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare productId: number

  @column()
  declare score: number

  @column()
  declare model: 'statistical' | 'lightgbm'

  @column()
  declare rank: number

  @column.dateTime()
  declare generatedAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // Relationships

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>
}
