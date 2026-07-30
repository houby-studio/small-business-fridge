import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import ProductRating from '#models/product_rating'

export default class ProductRatingUpvote extends BaseModel {
  static table = 'product_rating_upvotes'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare productRatingId: number

  @column()
  declare userId: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => ProductRating, { foreignKey: 'productRatingId' })
  declare rating: BelongsTo<typeof ProductRating>

  @belongsTo(() => User, { foreignKey: 'userId' })
  declare user: BelongsTo<typeof User>
}
