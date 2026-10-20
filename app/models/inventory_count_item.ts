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

  /** System stock at the moment the product was counted — what the count is compared with. */
  @column()
  declare expectedQty: number

  /**
   * The stock the inventory sheet showed, when it differs from `expectedQty`: sales,
   * deliveries and other counts between loading the sheet and counting moved it.
   */
  @column()
  declare sheetQty: number | null

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
