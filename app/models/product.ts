import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany, manyToMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany, ManyToMany } from '@adonisjs/lucid/types/relations'
import Allergen from '#models/allergen'
import Category from '#models/category'
import Delivery from '#models/delivery'
import ProductGroup from '#models/product_group'
import User from '#models/user'

export default class Product extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare keypadId: number

  @column()
  declare displayName: string

  @column()
  declare description: string | null

  @column()
  declare imagePath: string | null

  @column()
  declare categoryId: number

  @column()
  declare barcode: string | null

  /** Purchase group the shopping list plans this product in (null = planned on its own). */
  @column()
  declare productGroupId: number | null

  /** Set while the product is archived: hidden from the shop, kiosk and pickers. */
  @column.dateTime()
  declare archivedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // Relationships

  @belongsTo(() => Category)
  declare category: BelongsTo<typeof Category>

  @belongsTo(() => ProductGroup)
  declare productGroup: BelongsTo<typeof ProductGroup>

  @hasMany(() => Delivery)
  declare deliveries: HasMany<typeof Delivery>

  @manyToMany(() => User, {
    pivotTable: 'user_favorites',
    pivotTimestamps: { createdAt: 'created_at', updatedAt: false },
  })
  declare favoritedBy: ManyToMany<typeof User>

  @manyToMany(() => Allergen, {
    pivotTable: 'product_allergen',
  })
  declare allergens: ManyToMany<typeof Allergen>
}
