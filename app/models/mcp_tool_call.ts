import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

export default class McpToolCall extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  // bigInteger FK → pg returns as string; cast to number so BelongsTo eager-loading
  // can compare it correctly against users.id (which is integer → returned as number)
  @column({ consume: (v) => (v !== null && v !== undefined ? Number(v) : null) })
  declare userId: number | null

  @column()
  declare toolName: string

  @column()
  declare toolArguments: Record<string, any> | null

  @column()
  declare success: boolean

  @column()
  declare errorMessage: string | null

  @column()
  declare durationMs: number | null

  @column()
  declare userAgent: string | null

  @column()
  declare msCorrelationId: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => User, { foreignKey: 'userId' })
  declare user: BelongsTo<typeof User>
}
