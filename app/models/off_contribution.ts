import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Product from '#models/product'
import User from '#models/user'
import type { BackgroundMode } from '#services/product_images/product_image_service'

export type OffContributionStatus = 'pending' | 'done' | 'failed'

export interface OffContributionResult {
  productCreated: boolean
  nameSent: boolean
  /** What happened to each photo; `imgid` is OFF's id, `null` when it was not added. */
  images: {
    kind: 'cutout' | 'original'
    /** `front_cs` = became the front of the pack; `null` = not sent. */
    imagefield: string | null
    imgid: number | null
    /** Why OFF did not add it: it had the file already, it rejected it, no cut-out. */
    skipped?: string
  }[]
}

export default class OffContribution extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare productId: number

  /** Who agreed to the contribution. */
  @column()
  declare userId: number | null

  @column()
  declare barcode: string

  @column()
  declare productName: string

  @column({ serializeAs: null })
  declare originalImage: Buffer | null

  @column()
  declare originalMime: string | null

  @column()
  declare background: BackgroundMode

  @column()
  declare status: OffContributionStatus

  @column()
  declare attempts: number

  @column.dateTime()
  declare nextAttemptAt: DateTime

  @column()
  declare lastError: string | null

  @column({ prepare: (value: OffContributionResult | null) => value && JSON.stringify(value) })
  declare result: OffContributionResult | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @column.dateTime()
  declare completedAt: DateTime | null

  @belongsTo(() => Product)
  declare product: BelongsTo<typeof Product>

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
