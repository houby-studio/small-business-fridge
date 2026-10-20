import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type User from '#models/user'
import { registerCustomerTools } from '#mcp/tools/customer_tools'
import { registerSupplierTools } from '#mcp/tools/supplier_tools'
import { registerAdminTools } from '#mcp/tools/admin_tools'
import { registerPrompts } from '#mcp/prompts'
import McpToolCall from '#models/mcp_tool_call'

export interface McpLoggingContext {
  userId: number
  userAgent: string | null
  msCorrelationId: string | null
}

/** Longest error message kept in mcp_tool_calls — enough for the code and its hint. */
const ERROR_MESSAGE_MAX = 500

/**
 * Monkey-patches server.tool() so every tool call is logged to mcp_tool_calls.
 * Must be called BEFORE registering tools. Fire-and-forget — never blocks the response.
 *
 * Tools report domain errors as a result with `isError` rather than by throwing, so success
 * is read from the result. The patch covers `server.tool()` only (deprecated in SDK 1.29):
 * it must patch `registerTool()` too once tools move to it, or logging silently stops.
 */
function addToolLogging(server: McpServer, ctx: McpLoggingContext): void {
  const original = server.tool.bind(server) as (...args: unknown[]) => RegisteredTool
  ;(server as unknown as Record<string, unknown>).tool = (...args: unknown[]): RegisteredTool => {
    const toolName = args[0] as string
    const originalHandler = args[args.length - 1] as (...a: unknown[]) => Promise<unknown>
    args[args.length - 1] = async (...handlerArgs: unknown[]) => {
      const start = Date.now()
      const toolArguments = (handlerArgs[0] ?? null) as Record<string, unknown> | null
      try {
        const result = (await originalHandler(...handlerArgs)) as CallToolResult
        const failed = result?.isError === true
        const first = failed ? result.content?.[0] : undefined
        McpToolCall.create({
          userId: ctx.userId,
          toolName,
          toolArguments,
          success: !failed,
          errorMessage: first?.type === 'text' ? first.text.slice(0, ERROR_MESSAGE_MAX) : null,
          durationMs: Date.now() - start,
          userAgent: ctx.userAgent,
          msCorrelationId: ctx.msCorrelationId,
        }).catch(() => {})
        return result
      } catch (err) {
        McpToolCall.create({
          userId: ctx.userId,
          toolName,
          toolArguments,
          success: false,
          errorMessage: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
          userAgent: ctx.userAgent,
          msCorrelationId: ctx.msCorrelationId,
        }).catch(() => {})
        throw err
      }
    }
    return original(...args)
  }
}

/**
 * Creates a fully configured McpServer for the given authenticated user.
 * Tools are registered based on the user's role:
 *   - All users: shop browsing, purchases, orders, invoices, payments
 *   - supplier (and admin — admin implicitly has supplier access): stock,
 *     product catalog, invoice generation, payment approval
 *   - admin: user management, dashboard stats, storno, audit logs
 */
export function createMcpServer(user: User, loggingCtx?: McpLoggingContext): McpServer {
  const server = new McpServer({
    name: 'fridgora-mcp',
    version: '1.0.0',
  })

  if (loggingCtx) {
    addToolLogging(server, loggingCtx)
  }

  // Workflow prompts (role-aware, load once per session)
  registerPrompts(server, user)

  // Tools available to all authenticated users
  registerCustomerTools(server, user)

  // Supplier tools — admin implicitly has supplier access (mirrors role_middleware)
  if (user.role === 'supplier' || user.role === 'admin') {
    registerSupplierTools(server, user)
  }

  // Admin-only tools
  if (user.role === 'admin') {
    registerAdminTools(server, user)
  }

  return server
}
