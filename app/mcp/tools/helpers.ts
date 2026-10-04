import { type CallToolResult, type ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import { DomainError } from '#services/domain_error'

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

/** Absolute link into the web UI when APP_URL is known, else the path. */
export function webUrl(path: string): string {
  const base = env.get('APP_URL')
  return base ? `${base.replace(/\/+$/, '')}${path}` : path
}

// ── Annotations ───────────────────────────────────────────────────────────────
// MCP clients (Claude Desktop, claude.ai) use these hints to decide whether to ask the
// user before a call. Every tool states all four, so a client never falls back to the
// spec defaults (which treat an unannotated tool as a destructive write).

/** Reads data and changes nothing. */
export function readOnly(title: string): ToolAnnotations {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }
}

/** Writes that cannot be taken back (money moves, stock changes, e-mails go out). */
export function destructive(title: string, idempotent = false): ToolAnnotations {
  return {
    title,
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: idempotent,
    openWorldHint: false,
  }
}

/** Writes that are safe to repeat with the same arguments (upserts, metadata edits). */
export function idempotentWrite(title: string): ToolAnnotations {
  return {
    title,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }
}

/** Writes that add something new each time but destroy nothing (a draft, a list line). */
export function additiveWrite(title: string): ToolAnnotations {
  return {
    title,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  }
}

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * What the agent should do next for each domain error code. The message a tool returns is
 * `<fallback> (error code: <CODE>). <hint>` — the code is what the prompt and the docs
 * promise, the hint saves a round trip.
 */
export const ERROR_HINTS: Record<string, string> = {
  // Shop
  OUT_OF_STOCK: 'The product is out of stock — list_products shows what is available.',
  PRICE_CHANGED:
    'The lot sold next has a different price than the one requested — list the product again and confirm the new price with the user.',
  // Shared
  FORBIDDEN: 'This record belongs to someone else; you may only change your own.',
  NOT_FOUND: 'No record with this id — resolve ids with a list_* or get_* tool, never guess them.',
  VALIDATION: 'Check the arguments against the tool description.',
  INTERNAL: 'Unexpected server error — try once more, then tell the user to contact the admin.',
  // Invoices and payments
  ALREADY_PAID: 'The invoice is already paid.',
  ORDER_ALREADY_INVOICED: 'The order is already invoiced and cannot be cancelled.',
  // Users
  LAST_ACTIVE_ADMIN_REQUIRED: 'The last active admin cannot be demoted or disabled.',
  USER_HAS_UNINVOICED_ORDERS:
    'The user has uninvoiced orders or unpaid invoices — generate_invoices_for_user first, then disable once paid.',
  KEYPAD_ID_RESERVED:
    'This keypad ID is a kiosk code (easter egg or logout) and cannot be given to a user.',
  KEYPAD_ID_TAKEN: 'Another user already has this keypad ID.',
  // Catalog
  PRODUCT_NOT_FOUND: 'No product with this id — find it with list_catalog_products.',
  CATEGORY_NOT_FOUND: 'Pick a categoryId from list_categories.',
  GROUP_NOT_FOUND: 'No purchase group with this id — list_product_groups shows them.',
  GROUP_NAME_TAKEN: 'A group of this name exists — list_product_groups shows its id.',
  // Stocking
  PRICE_REQUIRED: 'Pass price (selling, whole CZK), purchasePrice (paid per piece) or both.',
  DRAFT_NOT_FOUND:
    'No open or closed draft with this id for you — list_stock_drafts shows your open ones.',
  DRAFT_CLOSED: 'The draft was already stocked or discarded — list_stock_drafts shows open ones.',
  DRAFT_EMPTY: 'The draft has no lines — add some with update_stock_draft or discard it.',
  DRAFT_INCOMPLETE:
    'A line has no product or no price — fix it with update_stock_draft or send the supplier reviewUrl.',
  NEEDS_CONFIRMATION:
    'The lines look like a double submit or carry an unusual price — show the warnings to the user and repeat with confirmWarnings: true only if they confirm.',
  // Deliveries
  DELIVERY_NOT_FOUND: 'No delivery lot with this id — recent_deliveries shows yours.',
  DELIVERY_VOIDED: 'This lot was already voided; nothing more can change on it.',
  DELIVERY_HAS_ORDERS:
    'Something already sold from this lot — use correct_delivery to lower the pieces instead of voiding it.',
  AMOUNT_BELOW_SOLD:
    'More pieces already sold than the new amount — the lot cannot go below what sold.',
  AMOUNT_INCREASE_NOT_ALLOWED: 'Extra pieces always come in as a new lot — use add_stock.',
  NO_CHANGE: 'Amount, price and purchase price all equal the current values — nothing to correct.',
  // Inventory
  NOT_ENOUGH_STOCK: 'Fewer pieces are in stock than you want to write off — check get_stock.',
  NOTHING_COUNTED: 'Pass at least one counted product.',
  NOTHING_TO_CLASSIFY:
    'This count found no missing pieces of that product — only a shortfall gets a reason.',
  // Shopping list
  LINE_NOT_FOUND:
    'No such line — keys come from get_shopping_list (g-<groupId>, p-<productId>, c-<itemId>).',
  LIST_EMPTY: 'The shopping list has nothing to buy.',
}

/** Legacy services throw plain Errors whose message is the code; this maps those too. */
const LEGACY_CODES: Record<string, string> = {
  E_ROW_NOT_FOUND: 'NOT_FOUND',
}

/** Builds the standard error message for a known code. */
export function describeError(code: string, fallback: string): string {
  const hint = ERROR_HINTS[code]
  return `${fallback} (error code: ${code}).${hint ? ` ${hint}` : ''}`
}

/** A failed result for a code the tool detected itself (no exception involved). */
export function failWithCode(code: string, fallback: string): CallToolResult {
  return fail(describeError(code, fallback))
}

/**
 * Maps a thrown error to an agent-friendly result. Domain errors keep their code and get a
 * hint; anything else (a database error, a bug) is logged and reported as INTERNAL — raw
 * driver messages never reach the agent.
 */
export function mapDomainError(err: unknown, fallback: string): CallToolResult {
  if (err instanceof DomainError) {
    return failWithCode(err.code, fallback)
  }

  const message = err instanceof Error ? err.message : String(err)
  for (const [legacy, code] of Object.entries(LEGACY_CODES)) {
    if (message.includes(legacy)) return failWithCode(code, fallback)
  }
  // Longest code first, so "PRODUCT_NOT_FOUND" is not caught by a shorter "NOT_FOUND".
  const codes = Object.keys(ERROR_HINTS).sort((a, b) => b.length - a.length)
  for (const code of codes) {
    if (message === code || message.includes(code)) return failWithCode(code, fallback)
  }

  logger.error({ err }, `MCP tool failed: ${fallback}`)
  return failWithCode('INTERNAL', fallback)
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
