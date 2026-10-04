import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import InventoryCount from '#models/inventory_count'
import Product from '#models/product'

export default class InventoryCountItem extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare inventoryCountId: number

  @column()
  declare productId: number

  /** System stock the counter saw when counting. */
  @column()
  declare expectedQty: number

  @column()
  declare countedQty: number

  /** Change actually applied to the lots: negative = written off, positive = added back. */
  @column()
  declare appliedQty: number

  @belongsTo(() => InventoryCount)
  declare inventoryCount: BelongsTo<typeof InventoryCount>

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>
}
