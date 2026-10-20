import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import StockDraft from '#models/stock_draft'
import Product from '#models/product'
import ProductGroup from '#models/product_group'

/** Who put the line on the draft: by hand, a finished shopping list, an AI assistant. */
export type StockDraftLineSource = 'web' | 'shopping_list' | 'assistant'

export default class StockDraftItem extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare stockDraftId: number

  /** Null until the supplier picks the product. */
  @column()
  declare productId: number | null

  @column()
  declare productGroupId: number | null

  @column()
  declare source: StockDraftLineSource

  /** The line as its source named it (receipt text, shopping-list line). */
  @column()
  declare label: string | null

  @column()
  declare amount: number

  @column({ consume: (value: string | null) => (value === null ? null : Number(value)) })
  declare purchasePrice: number | null

  /** The purchase price is an estimate (from the shopping list), not a receipt figure. */
  @column()
  declare purchasePriceEstimated: boolean

  /** Selling price per piece; null = suggest it from the purchase price and the margin. */
  @column()
  declare price: number | null

  @column()
  declare sortOrder: number

  @column()
  declare deliveryId: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => StockDraft)
  declare draft: BelongsTo<typeof StockDraft>

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>

  @belongsTo(() => ProductGroup)
  declare productGroup: BelongsTo<typeof ProductGroup>
}
