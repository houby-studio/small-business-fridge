import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/** Successful tool result with a pretty-printed JSON payload. */
export function ok(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  }
}

/** Failed tool result with a plain-text message the agent can relay to the user. */
export function fail(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}

/** Maps well-known service error codes to agent-friendly messages. */
export function mapDomainError(err: unknown, fallback: string): CallToolResult {
  const message = err instanceof Error ? err.message : String(err)
  const known: Record<string, string> = {
    OUT_OF_STOCK: 'The product is out of stock (error code: OUT_OF_STOCK).',
    FORBIDDEN: 'You are not allowed to perform this action on this record (error code: FORBIDDEN).',
    ALREADY_PAID: 'The invoice is already paid (error code: ALREADY_PAID).',
    ORDER_ALREADY_INVOICED:
      'The order is already invoiced and cannot be cancelled (error code: ORDER_ALREADY_INVOICED).',
    LAST_ACTIVE_ADMIN_REQUIRED:
      'Cannot demote or disable the last active admin (error code: LAST_ACTIVE_ADMIN_REQUIRED).',
    USER_HAS_UNINVOICED_ORDERS:
      'User has uninvoiced orders or unpaid invoices and cannot be disabled (error code: USER_HAS_UNINVOICED_ORDERS).',
    KEYPAD_ID_TAKEN:
      'The keypad ID is already taken by another user (error code: KEYPAD_ID_TAKEN).',
    E_ROW_NOT_FOUND: 'Record not found (error code: NOT_FOUND).',
  }
  for (const [code, text] of Object.entries(known)) {
    if (message.includes(code)) return fail(text)
  }
  return fail(`${fallback}: ${message}`)
}

/** Serializes a Lucid paginator's meta into a compact object. */
export function pageMeta(paginator: {
  total: number
  perPage: number
  currentPage: number
  lastPage: number
}) {
  return {
    total: paginator.total,
    perPage: paginator.perPage,
    currentPage: paginator.currentPage,
    lastPage: paginator.lastPage,
  }
}
