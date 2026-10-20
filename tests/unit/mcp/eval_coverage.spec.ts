import '#tests/test_context'
import { test } from '@japa/runner'
import { evalScenarios } from '#mcp/eval_scenarios'
import { liveToolDefinitions, toOpenAiMessage } from '../../../commands/mcp_eval.js'

/**
 * Tools no eval scenario expects as the first call — each with the reason. A new tool must
 * either get a scenario or a line here, so nobody adds a tool the eval never measures.
 */
const WITHOUT_SCENARIO: Record<string, string> = {}

test.group('MCP eval — scenario coverage', () => {
  test('every tool an admin sees is the expected tool of at least one scenario', async ({
    assert,
  }) => {
    const definitions = await liveToolDefinitions('admin')
    const tools = definitions.map((t) => t.function.name)
    const expected = new Set(evalScenarios.map((s) => s.expectedTool))

    const missing = tools.filter((name) => !expected.has(name) && !WITHOUT_SCENARIO[name])
    assert.deepEqual(missing, [], `tools without an eval scenario: ${missing.join(', ')}`)
    const stale = Object.keys(WITHOUT_SCENARIO).filter((name) => !tools.includes(name))
    assert.deepEqual(stale, [], `exceptions for tools that no longer exist: ${stale.join(', ')}`)
  })

  test('"ask first" scenarios pass without a call and fail on the forbidden one', ({ assert }) => {
    const askFirst = evalScenarios.filter((s) => s.allowNoTool)
    assert.includeMembers(
      askFirst.map((s) => s.id),
      ['warnings-need-consent', 'commit-without-review']
    )
    for (const scenario of askFirst) {
      assert.isTrue(scenario.validate(null).passed, `${scenario.id}: no call must pass`)
    }

    const commit = evalScenarios.find((s) => s.id === 'commit-without-review')!
    assert.isFalse(commit.validate({ name: 'commit_stock_draft', input: { draftId: 12 } }).passed)
    assert.isTrue(commit.validate({ name: 'get_stock_draft', input: { draftId: 12 } }).passed)

    const consent = evalScenarios.find((s) => s.id === 'warnings-need-consent')!
    assert.isFalse(
      consent.validate({
        name: 'add_stock',
        input: { productId: 5, amount: 24, price: 18, confirmWarnings: true },
      }).passed
    )
  })

  test('scenarios that must call a tool still fail without one', ({ assert }) => {
    for (const scenario of evalScenarios.filter((s) => !s.allowNoTool)) {
      assert.isFalse(scenario.validate(null).passed, `${scenario.id}: no call must fail`)
    }
  })

  test('history turns become OpenAI messages with matching tool call ids', ({ assert }) => {
    const consent = evalScenarios.find((s) => s.id === 'warnings-need-consent')!
    const messages = consent.history!.map(toOpenAiMessage)
    assert.deepEqual(
      messages.map((m) => m.role),
      ['user', 'assistant', 'tool']
    )
    const call = messages[1] as { tool_calls: Array<{ id: string; function: { name: string } }> }
    const result = messages[2] as { tool_call_id: string }
    assert.equal(call.tool_calls[0].function.name, 'add_stock')
    assert.equal(result.tool_call_id, call.tool_calls[0].id)
  })
})
