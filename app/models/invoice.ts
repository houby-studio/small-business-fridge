import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Order from '#models/order'

export default class Invoice extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare buyerId: number

  @column()
  declare supplierId: number

  @column()
  declare totalCost: number

  @column()
  declare isPaid: boolean

  @column()
  declare isPaymentRequested: boolean

  @column()
  declare autoReminderCount: number

  @column()
  declare manualReminderCount: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // Relationships

  @belongsTo(() => User, { foreignKey: 'buyerId' })
  declare buyer: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'supplierId' })
  declare supplier: BelongsTo<typeof User>

  @hasMany(() => Order)
  declare orders: HasMany<typeof Order>
}
