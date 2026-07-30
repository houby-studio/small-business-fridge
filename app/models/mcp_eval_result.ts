import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import McpEvalRun from '#models/mcp_eval_run'

export default class McpEvalResult extends BaseModel {
  static table = 'mcp_eval_results'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare runId: number

  @column()
  declare scenarioId: string

  @column()
  declare scenarioDescription: string

  @column()
  declare passed: boolean

  @column()
  declare toolCalled: string | null

  @column()
  declare toolInput: Record<string, unknown> | null

  @column()
  declare expectedTool: string

  @column()
  declare failureReason: string | null

  @column()
  declare durationMs: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => McpEvalRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof McpEvalRun>
}
