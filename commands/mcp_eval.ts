import { BaseCommand, flags } from '@adonisjs/core/ace'
import { DateTime } from 'luxon'
import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'
import type { EvalRole } from '#mcp/eval_scenarios'

/**
 * Well-known Azure OpenAI deployment → display label mapping.
 * Any deployment name not listed here will use the deployment name as its label.
 */
const MODEL_LABELS: Record<string, string> = {
  'gpt-5': 'GPT-5',
  'gpt-5-mini': 'GPT-5 Mini',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-4.1': 'GPT-4.1',
  'gpt-4.1-mini': 'GPT-4.1 Mini',
  'gpt-4.1-nano': 'GPT-4.1 Nano',
  'gpt-4-turbo': 'GPT-4 Turbo',
  'gpt-35-turbo': 'GPT-3.5 Turbo',
}

const ROLES: EvalRole[] = ['customer', 'supplier', 'admin']

export default class McpEval extends BaseCommand {
  static commandName = 'mcp:eval'
  static description =
    'Run MCP eval scenarios against an Azure OpenAI model and record results to DB'

  static options = {
    startApp: true,
  }

  @flags.string({
    description:
      'Azure OpenAI deployment name (overrides AZURE_OPENAI_DEPLOYMENT env var). ' +
      'Examples: gpt-4o, gpt-4.1, gpt-5-mini',
  })
  declare model: string | undefined

  @flags.string({
    description: 'Comma-separated scenario IDs to run (default: all)',
  })
  declare scenarios: string | undefined

  @flags.string({
    description:
      'System prompt to send before the user message: "workflow" prepends the role\'s ' +
      'workflow prompt (prompts.ts). Default: none — measures the tool descriptions alone',
  })
  declare system: string | undefined

  async run() {
    const { evalScenarios } = await import('#mcp/eval_scenarios')
    const { default: McpEvalRun } = await import('#models/mcp_eval_run')
    const { default: McpEvalResult } = await import('#models/mcp_eval_result')

    // ── Resolve config ────────────────────────────────────────────────────────
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT
    const apiKey = process.env.AZURE_OPENAI_API_KEY
    const deploymentFromEnv = process.env.AZURE_OPENAI_DEPLOYMENT ?? ''
    const deployment = (this.model || deploymentFromEnv).trim()
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2024-12-01-preview'

    if (this.system !== undefined && this.system !== 'workflow') {
      this.logger.error(`Unknown --system="${this.system}". Supported: workflow`)
      this.exitCode = 1
      return
    }
    const withWorkflowPrompt = this.system === 'workflow'

    if (!endpoint) {
      this.logger.error('AZURE_OPENAI_ENDPOINT environment variable is not set')
      this.logger.error('Set it to your Azure OpenAI resource endpoint, e.g.:')
      this.logger.error('  export AZURE_OPENAI_ENDPOINT=https://my-resource.openai.azure.com/')
      this.exitCode = 1
      return
    }
    if (!apiKey) {
      this.logger.error('AZURE_OPENAI_API_KEY environment variable is not set')
      this.exitCode = 1
      return
    }
    if (!deployment) {
      this.logger.error(
        'No deployment specified. Pass --model=<deployment-name> or set AZURE_OPENAI_DEPLOYMENT'
      )
      this.exitCode = 1
      return
    }

    const modelLabel = `${MODEL_LABELS[deployment] ?? deployment}${withWorkflowPrompt ? ' (+workflow prompt)' : ''}`

    // ── Filter scenarios ──────────────────────────────────────────────────────
    const scenarioFilter = this.scenarios ? this.scenarios.split(',').map((s) => s.trim()) : null
    const selectedScenarios = scenarioFilter
      ? evalScenarios.filter((s) => scenarioFilter.includes(s.id))
      : evalScenarios

    if (selectedScenarios.length === 0) {
      this.logger.error('No matching scenarios found')
      this.exitCode = 1
      return
    }

    // ── Tool definitions from the live MCP server, per role ───────────────────
    // The server is the single source of truth: what tools/list returns is what Claude
    // Desktop or Copilot see, so the eval cannot drift from it.
    const toolsByRole = new Map<EvalRole, ChatCompletionFunctionTool[]>()
    const systemByRole = new Map<EvalRole, string>()
    const rolesNeeded = new Set(selectedScenarios.map((s) => s.role))
    for (const role of ROLES) {
      if (!rolesNeeded.has(role)) continue
      toolsByRole.set(role, await liveToolDefinitions(role))
      if (withWorkflowPrompt) {
        const { buildWorkflowGuide } = await import('#mcp/prompts')
        systemByRole.set(
          role,
          buildWorkflowGuide(role === 'supplier' || role === 'admin', role === 'admin')
        )
      }
    }

    this.logger.info(
      `Starting MCP eval: deployment=${deployment}, scenarios=${selectedScenarios.length}, ` +
        `system=${withWorkflowPrompt ? 'workflow' : 'none'}, tools: ` +
        [...toolsByRole.entries()].map(([role, tools]) => `${role}=${tools.length}`).join(' ')
    )

    // ── Create run record ─────────────────────────────────────────────────────
    const run = await McpEvalRun.create({
      modelId: deployment,
      modelLabel,
      status: 'running',
      startedAt: DateTime.utc(),
      passCount: 0,
      failCount: 0,
      errorCount: 0,
      totalCount: selectedScenarios.length,
    })

    let passCount = 0
    let failCount = 0
    let errorCount = 0

    // Persist final status — always called, even on signal or unexpected error
    const finalizeRun = async (status: 'completed' | 'failed') => {
      run.status = status
      run.passCount = passCount
      run.failCount = failCount
      run.errorCount = errorCount
      run.finishedAt = DateTime.utc()
      try {
        await run.save()
      } catch (saveErr) {
        this.logger.error(
          `Failed to persist run status: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`
        )
      }
    }

    // Ensure the run is marked failed if the process is killed mid-eval
    const handleSignal = async () => {
      this.logger.warning('Process interrupted — saving run as failed')
      await finalizeRun('failed')
      process.exit(1)
    }
    process.once('SIGTERM', handleSignal)
    process.once('SIGINT', handleSignal)

    try {
      // Import the Azure OpenAI client from the openai package
      const { AzureOpenAI } = await import('openai')
      const client = new AzureOpenAI({
        endpoint,
        apiKey,
        apiVersion,
        deployment,
      })

      for (const scenario of selectedScenarios) {
        const startTime = Date.now()
        let toolCall: { name: string; input: Record<string, unknown> } | null = null
        let validationResult: { passed: boolean; reason: string }
        let isError = false

        try {
          const system = systemByRole.get(scenario.role)
          const response = await client.chat.completions.create({
            model: deployment,
            max_completion_tokens: 1024,
            tools: toolsByRole.get(scenario.role)!,
            tool_choice: 'required',
            messages: [
              ...(system ? [{ role: 'system' as const, content: system }] : []),
              { role: 'user', content: scenario.userMessage },
            ],
          })

          const toolUseBlock = response.choices[0]?.message.tool_calls?.[0]
          if (toolUseBlock?.type === 'function') {
            let parsedArgs: Record<string, unknown> = {}
            try {
              parsedArgs = JSON.parse(toolUseBlock.function.arguments) as Record<string, unknown>
            } catch {
              // leave empty — will fail validation
            }
            toolCall = {
              name: toolUseBlock.function.name,
              input: parsedArgs,
            }
          }

          validationResult = scenario.validate(toolCall)
        } catch (err) {
          isError = true
          validationResult = {
            passed: false,
            reason: `API error: ${err instanceof Error ? err.message : String(err)}`,
          }
        }

        const durationMs = Date.now() - startTime

        if (isError) {
          errorCount++
        } else if (validationResult.passed) {
          passCount++
        } else {
          failCount++
        }

        const icon = validationResult.passed ? '✅' : '❌'
        this.logger.info(
          `${icon} ${scenario.id} [${scenario.role}]: ${validationResult.passed ? 'PASS' : 'FAIL'} (${durationMs}ms)` +
            (validationResult.reason !== 'Correct' ? ` — ${validationResult.reason}` : '')
        )

        // Persist result — isolated so a single DB write failure doesn't abort the run
        try {
          await McpEvalResult.create({
            runId: run.id,
            scenarioId: scenario.id,
            scenarioDescription: scenario.description,
            passed: validationResult.passed,
            toolCalled: toolCall?.name ?? null,
            toolInput: toolCall?.input ?? null,
            expectedTool: scenario.expectedTool,
            failureReason: validationResult.passed ? null : validationResult.reason,
            durationMs,
          })
        } catch (dbErr) {
          this.logger.error(
            `Failed to save result for ${scenario.id}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`
          )
        }
      }

      await finalizeRun('completed')
    } catch (err) {
      this.logger.error(`Eval run failed: ${err instanceof Error ? err.message : String(err)}`)
      await finalizeRun('failed')
    } finally {
      process.off('SIGTERM', handleSignal)
      process.off('SIGINT', handleSignal)
    }

    const total = selectedScenarios.length
    const passRate = total > 0 ? ((passCount / total) * 100).toFixed(1) : '0.0'

    this.logger.info('')
    this.logger.info(`Results: ${passCount} passed, ${failCount} failed, ${errorCount} errors`)
    this.logger.info(`Pass rate: ${passRate}%`)
    this.logger.info(
      `Run ID: ${run.id} — results stored in mcp_eval_runs / mcp_eval_results tables`
    )
  }
}

/**
 * The tools a user of `role` gets from the MCP server, in OpenAI function-calling shape.
 * Registration reads only the role, so an unsaved in-memory user is enough; `tools/list`
 * already returns the input schema as JSON Schema.
 */
export async function liveToolDefinitions(role: EvalRole): Promise<ChatCompletionFunctionTool[]> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const { createMcpServer } = await import('#mcp/server')
  const { default: User } = await import('#models/user')

  const user = new User()
  user.id = 0
  user.role = role
  user.marginPercent = 0

  const server = createMcpServer(user)
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = new Client({ name: 'mcp-eval', version: '1.0.0' })
  await client.connect(clientSide)
  try {
    const { tools } = await client.listTools()
    return tools.map((tool) => {
      // OpenAI wants a bare JSON Schema object; the draft marker the SDK adds is noise there.
      const parameters = { ...(tool.inputSchema as Record<string, unknown>) }
      delete parameters.$schema
      return {
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description ?? '',
          parameters,
        },
      }
    })
  } finally {
    await client.close()
    await server.close()
  }
}
