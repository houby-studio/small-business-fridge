import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Product from '#models/product'
import ProductRatingUpvote from '#models/product_rating_upvote'

export type RatingVisibility = 'public' | 'private'

export default class ProductRating extends BaseModel {
  static table = 'product_ratings'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare productId: number

  @column()
  declare stars: number

  @column()
  declare comment: string | null

  @column()
  declare visibility: RatingVisibility

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User, { foreignKey: 'userId' })
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Product, { foreignKey: 'productId' })
  declare product: BelongsTo<typeof Product>

  @hasMany(() => ProductRatingUpvote, { foreignKey: 'productRatingId' })
  declare upvotes: HasMany<typeof ProductRatingUpvote>
}
