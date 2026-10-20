import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Product from '#models/product'
import Order from '#models/order'
import DeliveryCorrection from '#models/delivery_correction'

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

  /** What customers pay per piece, in whole currency units. */
  @column()
  declare price: number

  /** What the supplier paid per piece (null = not recorded). */
  @column({ consume: (value: string | null) => (value === null ? null : Number(value)) })
  declare purchasePrice: number | null

  /**
   * Net shrinkage of the lot from write-offs and inventories (negative when an inventory
   * found more pieces). Sold = amountSupplied - amountLeft - amountLost.
   */
  @column()
  declare amountLost: number

  /** Set when the delivery was voided (nothing sold from it); its amounts are then zero. */
  @column.dateTime()
  declare voidedAt: DateTime | null

  /** The lot this one was split off when a leaving supplier handed their stock over. */
  @column()
  declare transferredFromId: number | null

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

  @hasMany(() => DeliveryCorrection)
  declare corrections: HasMany<typeof DeliveryCorrection>

  @belongsTo(() => Delivery, { foreignKey: 'transferredFromId' })
  declare transferredFrom: BelongsTo<typeof Delivery>

  /** The lots split off this one by a handover (one per handover; usually none). */
  @hasMany(() => Delivery, { foreignKey: 'transferredFromId' })
  declare transferredTo: HasMany<typeof Delivery>
}
