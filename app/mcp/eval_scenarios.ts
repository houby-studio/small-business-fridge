/**
 * MCP eval scenarios — each tests whether an AI model calls the right tool
 * with sensible parameters given a natural-language user message (Czech and
 * English, matching real office usage).
 *
 * ## Adding scenarios from real feedback
 *
 * When an AI assistant misbehaves on a real user message:
 * 1. Copy the exact user message verbatim.
 * 2. Determine: what tool was called → what should have been called.
 * 3. Add a scenario here with source: 'user_feedback'.
 * 4. Re-run eval: `node ace mcp:eval --model=gpt-4o`
 *    - If it passes → the model already handles it; scenario becomes a regression guard.
 *    - If it fails → fix prompts.ts or tool descriptions, then re-run until it passes.
 */

export interface EvalScenario {
  id: string
  description: string
  userMessage: string
  expectedTool: string
  /** Alternative tool names that are also acceptable. */
  allowedTools?: string[]
  /**
   * Where this scenario came from.
   * - 'synthetic'      handcrafted test covering expected behaviour
   * - 'user_feedback'  derived from real user feedback
   */
  source?: 'synthetic' | 'user_feedback'
  validate: (toolCall: { name: string; input: Record<string, unknown> } | null) => {
    passed: boolean
    reason: string
  }
}

/** Check that a tool call was made to one of the expected tools. */
function expectTool(
  toolCall: { name: string; input: Record<string, unknown> } | null,
  expected: string,
  allowed?: string[]
): { ok: boolean; reason: string } {
  if (!toolCall) {
    return { ok: false, reason: 'No tool call was made' }
  }
  const validNames = [expected, ...(allowed ?? [])]
  if (!validNames.includes(toolCall.name)) {
    return {
      ok: false,
      reason: `Expected tool "${expected}" (or ${validNames.join('/')}), got "${toolCall.name}"`,
    }
  }
  return { ok: true, reason: '' }
}

function simpleScenario(
  id: string,
  description: string,
  userMessage: string,
  expectedTool: string,
  allowedTools?: string[]
): EvalScenario {
  return {
    id,
    description,
    userMessage,
    expectedTool,
    allowedTools,
    source: 'synthetic',
    validate: (toolCall) => {
      const check = expectTool(toolCall, expectedTool, allowedTools)
      return { passed: check.ok, reason: check.ok ? 'Correct' : check.reason }
    },
  }
}

export const evalScenarios: EvalScenario[] = [
  // ── Customer: browsing ──────────────────────────────────────────────────────
  simpleScenario(
    'browse-shop-cs',
    'Czech request to see what is in the fridge should list products',
    'Co je v lednici k dostání?',
    'list_products'
  ),
  simpleScenario(
    'browse-shop-en',
    'English request for available drinks should list products',
    'What drinks can I buy right now?',
    'list_products'
  ),

  // ── Customer: buying ────────────────────────────────────────────────────────
  {
    id: 'buy-named-product-cs',
    description: 'Buying a product by name should first look it up in the shop',
    userMessage: 'Kup mi jednu kofolu',
    expectedTool: 'list_products',
    allowedTools: ['buy_product'],
    source: 'synthetic',
    validate: (toolCall) => {
      // Either list first (to resolve the ID) or buy directly — but a direct buy
      // must not invent a numeric ID out of thin air.
      if (!toolCall) return { passed: false, reason: 'No tool call was made' }
      if (toolCall.name === 'list_products') return { passed: true, reason: 'Correct' }
      if (toolCall.name === 'buy_product') {
        return {
          passed: false,
          reason: 'Called buy_product directly with an invented ID instead of list_products first',
        }
      }
      return { passed: false, reason: `Unexpected tool "${toolCall.name}"` }
    },
  },
  {
    id: 'buy-with-quantity',
    description: 'Buying N units by product ID should pass quantity',
    userMessage: 'Buy 3 units of the product with delivery lot 42.',
    expectedTool: 'buy_product',
    source: 'synthetic',
    validate: (toolCall) => {
      const check = expectTool(toolCall, 'buy_product')
      if (!check.ok) return { passed: false, reason: check.reason }
      const qty = Number(toolCall!.input.quantity ?? 1)
      const deliveryId = Number(toolCall!.input.deliveryId ?? 0)
      if (deliveryId !== 42) {
        return { passed: false, reason: `Expected deliveryId 42, got ${deliveryId}` }
      }
      if (qty !== 3) return { passed: false, reason: `Expected quantity 3, got ${qty}` }
      return { passed: true, reason: 'Correct' }
    },
  },

  // ── Customer: orders & invoices ─────────────────────────────────────────────
  simpleScenario(
    'order-history-cs',
    'Czech question about recent purchases should list own orders',
    'Co jsem si tenhle týden koupil?',
    'get_my_orders'
  ),
  simpleScenario(
    'debt-question-cs',
    'Czech question about debts should list own unpaid invoices',
    'Kolik dlužím za lednici?',
    'get_my_invoices'
  ),
  {
    id: 'unpaid-invoices-filter',
    description: 'Asking for unpaid invoices should filter by status',
    userMessage: 'Show my unpaid fridge invoices.',
    expectedTool: 'get_my_invoices',
    source: 'synthetic',
    validate: (toolCall) => {
      const check = expectTool(toolCall, 'get_my_invoices')
      if (!check.ok) return { passed: false, reason: check.reason }
      if (toolCall!.input.status !== 'unpaid') {
        return {
          passed: false,
          reason: `Expected status "unpaid", got "${toolCall!.input.status}"`,
        }
      }
      return { passed: true, reason: 'Correct' }
    },
  },
  {
    id: 'payment-qr',
    description: 'Asking how to pay a specific invoice should fetch the QR payment string',
    userMessage: 'Jak zaplatím fakturu číslo 12? Chci QR kód.',
    expectedTool: 'get_payment_qr',
    source: 'synthetic',
    validate: (toolCall) => {
      const check = expectTool(toolCall, 'get_payment_qr')
      if (!check.ok) return { passed: false, reason: check.reason }
      if (Number(toolCall!.input.invoiceId) !== 12) {
        return { passed: false, reason: `Expected invoiceId 12, got ${toolCall!.input.invoiceId}` }
      }
      return { passed: true, reason: 'Correct' }
    },
  },
  {
    id: 'report-payment',
    description: 'Reporting a completed bank transfer should call request_payment',
    userMessage: 'Už jsem fakturu 7 zaplatil převodem, dej vědět dodavateli.',
    expectedTool: 'request_payment',
    source: 'synthetic',
    validate: (toolCall) => {
      const check = expectTool(toolCall, 'request_payment')
      if (!check.ok) return { passed: false, reason: check.reason }
      if (Number(toolCall!.input.invoiceId) !== 7) {
        return { passed: false, reason: `Expected invoiceId 7, got ${toolCall!.input.invoiceId}` }
      }
      return { passed: true, reason: 'Correct' }
    },
  },
  simpleScenario(
    'recommendations-cs',
    'Asking what to buy should use recommendations',
    'Nevím co si dát, co mi doporučíš?',
    'get_recommendations',
    ['list_products']
  ),

  // ── Supplier: stocking ──────────────────────────────────────────────────────
  {
    id: 'add-stock',
    description: 'Restocking with amount and price should call add_stock',
    userMessage: 'Naskladni 24 kusů produktu 5 po 18 korunách.',
    expectedTool: 'add_stock',
    source: 'synthetic',
    validate: (toolCall) => {
      const check = expectTool(toolCall, 'add_stock')
      if (!check.ok) return { passed: false, reason: check.reason }
      const { productId, amount, price } = toolCall!.input
      if (Number(productId) !== 5) {
        return { passed: false, reason: `Expected productId 5, got ${productId}` }
      }
      if (Number(amount) !== 24) {
        return { passed: false, reason: `Expected amount 24, got ${amount}` }
      }
      if (Number(price) !== 18) {
        return { passed: false, reason: `Expected price 18, got ${price}` }
      }
      return { passed: true, reason: 'Correct' }
    },
  },
  simpleScenario(
    'low-stock-check',
    'Asking what is running low should check the stock overview',
    'Co v lednici dochází a měl bych dokoupit?',
    'get_stock',
    ['list_products']
  ),
  simpleScenario(
    'find-product-in-catalog',
    'Finding a product to restock should search the catalog (incl. out-of-stock)',
    'Najdi v katalogu produkt s čárovým kódem 8590121052023.',
    'list_catalog_products',
    ['list_products']
  ),

  // ── Supplier: invoicing ─────────────────────────────────────────────────────
  simpleScenario(
    'who-owes-me',
    'Asking who owes money should use the uninvoiced summary',
    'Kdo mi ještě dluží za nákupy, co jsem nevyfakturoval?',
    'uninvoiced_summary',
    ['list_issued_invoices']
  ),
  simpleScenario(
    'monthly-billing',
    'Monthly billing run should generate invoices',
    'Vyfakturuj všem jejich nákupy za tenhle měsíc.',
    'generate_invoices'
  ),
  {
    id: 'confirm-payment',
    description: 'Confirming a received payment should call approve_payment',
    userMessage: 'Platba za fakturu 33 mi přišla na účet, potvrď ji.',
    expectedTool: 'approve_payment',
    source: 'synthetic',
    validate: (toolCall) => {
      const check = expectTool(toolCall, 'approve_payment')
      if (!check.ok) return { passed: false, reason: check.reason }
      if (Number(toolCall!.input.invoiceId) !== 33) {
        return { passed: false, reason: `Expected invoiceId 33, got ${toolCall!.input.invoiceId}` }
      }
      return { passed: true, reason: 'Correct' }
    },
  },
  simpleScenario(
    'pending-confirmations',
    'Asking which payments wait for confirmation should filter issued invoices',
    'Které platby čekají na moje potvrzení?',
    'list_issued_invoices'
  ),

  // ── Admin ───────────────────────────────────────────────────────────────────
  simpleScenario(
    'admin-overview',
    'Asking for an overall status should fetch dashboard stats',
    'Dej mi celkový přehled, jak si lednice vede.',
    'dashboard_stats'
  ),
  {
    id: 'disable-user',
    description: 'Disabling a user account should call update_user with isDisabled',
    userMessage: 'Zablokuj uživatelský účet číslo 8.',
    expectedTool: 'update_user',
    source: 'synthetic',
    validate: (toolCall) => {
      const check = expectTool(toolCall, 'update_user')
      if (!check.ok) return { passed: false, reason: check.reason }
      if (Number(toolCall!.input.userId) !== 8) {
        return { passed: false, reason: `Expected userId 8, got ${toolCall!.input.userId}` }
      }
      if (toolCall!.input.isDisabled !== true) {
        return { passed: false, reason: 'Expected isDisabled: true' }
      }
      return { passed: true, reason: 'Correct' }
    },
  },
  {
    id: 'storno-order',
    description: 'Cancelling an order should call storno_order',
    userMessage: 'Stornuj objednávku 101, byl to omyl.',
    expectedTool: 'storno_order',
    source: 'synthetic',
    validate: (toolCall) => {
      const check = expectTool(toolCall, 'storno_order')
      if (!check.ok) return { passed: false, reason: check.reason }
      if (Number(toolCall!.input.orderId) !== 101) {
        return { passed: false, reason: `Expected orderId 101, got ${toolCall!.input.orderId}` }
      }
      return { passed: true, reason: 'Correct' }
    },
  },
  simpleScenario(
    'audit-question',
    'Asking who changed something should query the audit log',
    'Kdo naposledy měnil role uživatelů?',
    'get_audit_logs',
    ['list_users']
  ),
]
