import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

export default class UserInvitation extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare email: string

  @column()
  declare role: 'customer' | 'supplier' | 'admin'

  @column({ serializeAs: null })
  declare tokenHash: string

  @column()
  declare invitedByUserId: number | null

  @column()
  declare acceptedUserId: number | null

  @column.dateTime()
  declare expiresAt: DateTime

  @column.dateTime()
  declare acceptedAt: DateTime | null

  @column.dateTime()
  declare revokedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User, { foreignKey: 'invitedByUserId' })
  declare invitedByUser: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'acceptedUserId' })
  declare acceptedUser: BelongsTo<typeof User>
}
