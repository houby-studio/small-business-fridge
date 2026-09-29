import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, beforeCreate } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import Delivery from '#models/delivery'
import Invoice from '#models/invoice'
import DeliveryCorrection from '#models/delivery_correction'

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

  /** Price the buyer pays for this unit — snapshotted, see the add_unit_price migration. */
  @column()
  declare unitPrice: number

  /** Price at purchase time, set only once a correction changed `unitPrice`. */
  @column()
  declare originalUnitPrice: number | null

  @column()
  declare priceCorrectionId: number | null

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

  @belongsTo(() => DeliveryCorrection, { foreignKey: 'priceCorrectionId' })
  declare priceCorrection: BelongsTo<typeof DeliveryCorrection>

  // Hooks

  /**
   * Fall back to the delivery's current price when the caller did not snapshot one, so an
   * order can never be created without a price.
   */
  @beforeCreate()
  static async snapshotUnitPrice(order: Order) {
    if (order.unitPrice !== undefined && order.unitPrice !== null) return

    const delivery = await Delivery.query({ client: order.$trx })
      .where('id', order.deliveryId)
      .firstOrFail()
    order.unitPrice = delivery.price
  }
}
