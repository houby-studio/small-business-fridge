import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import McpEvalResult from '#models/mcp_eval_result'

export default class McpEvalRun extends BaseModel {
  static table = 'mcp_eval_runs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare modelId: string

  @column()
  declare modelLabel: string | null

  @column()
  declare status: 'running' | 'completed' | 'failed'

  @column.dateTime()
  declare startedAt: DateTime

  @column.dateTime()
  declare finishedAt: DateTime | null

  @column()
  declare passCount: number

  @column()
  declare failCount: number

  @column()
  declare errorCount: number

  @column()
  declare totalCount: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @hasMany(() => McpEvalResult, { foreignKey: 'runId' })
  declare results: HasMany<typeof McpEvalResult>
}
