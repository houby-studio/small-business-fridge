import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Delivery from '#models/delivery'
import Product from '#models/product'
import User from '#models/user'
import InventoryCount from '#models/inventory_count'

export type StockAdjustmentKind = 'loss' | 'surplus'
/**
 * Why pieces went missing. `inventory` is a shortfall an inventory found that has no reason
 * yet ("not specified"); the supplier can reclassify it afterwards. Surplus rows keep it.
 */
export type StockAdjustmentReason = 'inventory' | 'damaged' | 'expired' | 'stolen' | 'other'

/** One change of a lot outside a sale: a write-off, or an inventory difference. */
export default class StockAdjustment extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare deliveryId: number

  @column()
  declare productId: number

  /** Owner of the lot. */
  @column()
  declare supplierId: number

  @column()
  declare actorId: number

  @column()
  declare impersonatorId: number | null

  @column()
  declare kind: StockAdjustmentKind

  @column()
  declare reason: StockAdjustmentReason

  /** Always positive — `kind` says which way it went. */
  @column()
  declare quantity: number

  /** Purchase price of the lot at the time (null = not recorded). */
  @column({ consume: (value: string | null) => (value === null ? null : Number(value)) })
  declare unitCost: number | null

  /** Selling price of the lot at the time. */
  @column()
  declare unitPrice: number

  @column()
  declare inventoryCountId: number | null

  @column()
  declare note: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  /** Set when a mistaken write-off was taken back — the pieces went back onto the lot. */
  @column.dateTime()
  declare revertedAt: DateTime | null

  @column()
  declare revertedBy: number | null

  @belongsTo(() => Delivery)
  declare delivery: BelongsTo<typeof Delivery>

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>

  @belongsTo(() => User, { foreignKey: 'supplierId' })
  declare supplier: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'actorId' })
  declare actor: BelongsTo<typeof User>

  @belongsTo(() => InventoryCount)
  declare inventoryCount: BelongsTo<typeof InventoryCount>
}
