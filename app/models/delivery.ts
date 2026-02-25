import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Product from '#models/product'
import Order from '#models/order'

export default class Delivery extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare supplierId: number

  @column()
  declare productId: number

  @column()
  declare amountSupplied: number

  @column()
  declare amountLeft: number

  @column()
  declare price: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // Relationships

  @belongsTo(() => User, { foreignKey: 'supplierId' })
  declare supplier: BelongsTo<typeof User>

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>

  @hasMany(() => Order)
  declare orders: HasMany<typeof Order>
}
