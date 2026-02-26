import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

export default class MusicTrack extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare filePath: string

  @column()
  declare mimeType: string

  @column()
  declare accessLevel: 'public' | 'premium'

  @column()
  declare isDisabled: boolean

  @column()
  declare uploadedByUserId: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User, { foreignKey: 'uploadedByUserId' })
  declare uploadedByUser: BelongsTo<typeof User>
}
