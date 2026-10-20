import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Delivery from '#models/delivery'

export type DeliveryCorrectionKind = 'update' | 'void' | 'reprice' | 'transfer'

export default class DeliveryCorrection extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare deliveryId: number

  @column()
  declare actorId: number

  /** The admin really behind the change when they acted while impersonating the actor. */
  @column()
  declare impersonatorId: number | null

  @column()
  declare kind: DeliveryCorrectionKind

  @column()
  declare reason: string

  @column()
  declare oldAmountSupplied: number

  @column()
  declare newAmountSupplied: number

  @column()
  declare oldPrice: number

  @column()
  declare newPrice: number

  /** Purchase price before and after; both null when the lot never had one. */
  @column({ consume: (value: string | null) => (value === null ? null : Number(value)) })
  declare oldPurchasePrice: number | null

  @column({ consume: (value: string | null) => (value === null ? null : Number(value)) })
  declare newPurchasePrice: number | null

  @column()
  declare repricedOrderCount: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // Relationships

  @belongsTo(() => Delivery)
  declare delivery: BelongsTo<typeof Delivery>

  @belongsTo(() => User, { foreignKey: 'actorId' })
  declare actor: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'impersonatorId' })
  declare impersonator: BelongsTo<typeof User>
}
