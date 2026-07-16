import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class McpOauthClient extends BaseModel {
  static table = 'mcp_oauth_clients'
  static selfAssignPrimaryKey = true

  @column({ isPrimary: true })
  declare clientId: string

  @column()
  declare clientName: string

  /** JSON-serialised string[]. Use redirectUris getter below. */
  @column({ columnName: 'redirect_uris', serializeAs: null })
  declare redirectUrisRaw: string

  /** JSON-serialised string[]. Use grantTypes getter below. */
  @column({ columnName: 'grant_types', serializeAs: null })
  declare grantTypesRaw: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  get redirectUris(): string[] {
    return JSON.parse(this.redirectUrisRaw)
  }

  get grantTypes(): string[] {
    return JSON.parse(this.grantTypesRaw)
  }
}
