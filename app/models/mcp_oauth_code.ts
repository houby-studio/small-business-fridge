import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import McpOauthClient from '#models/mcp_oauth_client'

export default class McpOauthCode extends BaseModel {
  static table = 'mcp_oauth_codes'
  static selfAssignPrimaryKey = true

  @column({ isPrimary: true })
  declare code: string

  @column()
  declare clientId: string

  @column()
  declare userId: number

  @column()
  declare redirectUri: string

  @column()
  declare codeChallenge: string

  @column()
  declare used: boolean

  @column.dateTime()
  declare expiresAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => User, { foreignKey: 'userId' })
  declare user: BelongsTo<typeof User>

  @belongsTo(() => McpOauthClient, { foreignKey: 'clientId' })
  declare client: BelongsTo<typeof McpOauthClient>

  get isExpired(): boolean {
    return this.expiresAt < DateTime.now()
  }
}
