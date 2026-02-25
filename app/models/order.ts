import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Delivery from '#models/delivery'
import Invoice from '#models/invoice'

export default class Order extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare buyerId: number

  @column()
  declare deliveryId: number

  @column()
  declare invoiceId: number | null

  @column()
  declare channel: 'web' | 'kiosk' | 'scanner'

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // Relationships

  @belongsTo(() => User, { foreignKey: 'buyerId' })
  declare buyer: BelongsTo<typeof User>

  @belongsTo(() => Delivery)
  declare delivery: BelongsTo<typeof Delivery>

  @belongsTo(() => Invoice)
  declare invoice: BelongsTo<typeof Invoice>
}
