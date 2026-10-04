/**
 * MCP eval scenarios — each tests whether an AI model calls the right tool
 * with sensible parameters given a natural-language user message (Czech and
 * English, matching real office usage).
 *
 * The model sees exactly the tools the scenario's `role` gets from the live MCP server
 * (suppliers also see the customer tools, admins see everything), so a scenario also
 * guards against a tool of another job being picked — e.g. get_recommendations when a
 * supplier asks what to buy for the fridge.
 *
 * ## Adding scenarios from real feedback
 *
 * When an AI assistant misbehaves on a real user message:
 * 1. Copy the exact user message verbatim.
 * 2. Determine: what tool was called → what should have been called, and for which role.
 * 3. Add a scenario here with source: 'user_feedback'.
 * 4. Re-run eval: `node ace mcp:eval --model=gpt-4o` (descriptions only) and
 *    `node ace mcp:eval --model=gpt-4o --system=workflow` (with the workflow prompt).
 *    - If it passes → the model already handles it; scenario becomes a regression guard.
 *    - If it fails without the prompt → fix the tool descriptions; if it fails with it too,
 *      fix prompts.ts as well. Re-run until it passes.
 */

export type EvalRole = 'customer' | 'supplier' | 'admin'

export interface EvalToolCall {
  name: string
  input: Record<string, unknown>
}

export interface EvalScenario {
  id: string
  /** Whose tools the model sees — a supplier also sees the customer tools, an admin all. */
  role: EvalRole
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
  validate: (toolCall: EvalToolCall | null) => {
    passed: boolean
    reason: string
  }
}

/** Check that a tool call was made to one of the expected tools. */
function expectTool(
  toolCall: EvalToolCall | null,
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
  role: EvalRole,
  description: string,
  userMessage: string,
  expectedTool: string,
  allowedTools?: string[]
): EvalScenario {
  return {
    id,
    role,
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

/**
 * A scenario whose first call must be `expectedTool` (or an allowed alternative); when it is
 * the expected tool, `checkInput` also inspects the arguments and returns a failure reason or
 * null.
 */
function paramScenario(
  id: string,
  role: EvalRole,
  description: string,
  userMessage: string,
  expectedTool: string,
  checkInput: (input: Record<string, unknown>) => string | null,
  allowedTools?: string[]
): EvalScenario {
  return {
    id,
    role,
    description,
    userMessage,
    expectedTool,
    allowedTools,
    source: 'synthetic',
    validate: (toolCall) => {
      const check = expectTool(toolCall, expectedTool, allowedTools)
      if (!check.ok) return { passed: false, reason: check.reason }
      if (toolCall!.name !== expectedTool) {
        return { passed: true, reason: `Acceptable first step via ${toolCall!.name}` }
      }
      const problem = checkInput(toolCall!.input)
      return problem ? { passed: false, reason: problem } : { passed: true, reason: 'Correct' }
    },
  }
}

const num = (value: unknown) => (value === undefined || value === null ? Number.NaN : Number(value))

export const evalScenarios: EvalScenario[] = [
  // ── Customer: browsing ──────────────────────────────────────────────────────
  simpleScenario(
    'browse-shop-cs',
    'customer',
    'Czech request to see what is in the fridge should list products',
    'Co je v lednici k dostání?',
    'list_products'
  ),
  simpleScenario(
    'browse-shop-en',
    'customer',
    'English request for available drinks should list products',
    'What drinks can I buy right now?',
    'list_products'
  ),

  // ── Customer: buying ────────────────────────────────────────────────────────
  {
    id: 'buy-named-product-cs',
    role: 'customer',
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
  paramScenario(
    'buy-with-quantity',
    'customer',
    'Buying N pieces by delivery lot should pass quantity and deliveryId',
    'Buy 3 units of the product with delivery lot 42.',
    'buy_product',
    (input) => {
      if (num(input.deliveryId) !== 42) return `Expected deliveryId 42, got ${input.deliveryId}`
      if (num(input.quantity ?? 1) !== 3) return `Expected quantity 3, got ${input.quantity}`
      return null
    }
  ),

  // ── Customer: orders & invoices ─────────────────────────────────────────────
  simpleScenario(
    'order-history-cs',
    'customer',
    'Czech question about recent purchases should list own orders',
    'Co jsem si tenhle týden koupil?',
    'get_my_orders'
  ),
  simpleScenario(
    'debt-question-cs',
    'customer',
    'Czech question about debts should list own unpaid invoices',
    'Kolik dlužím za lednici?',
    'get_my_invoices'
  ),
  paramScenario(
    'unpaid-invoices-filter',
    'customer',
    'Asking for unpaid invoices should filter by status',
    'Show my unpaid fridge invoices.',
    'get_my_invoices',
    (input) =>
      input.status === 'unpaid' ? null : `Expected status "unpaid", got "${input.status}"`
  ),
  paramScenario(
    'payment-qr',
    'customer',
    'Asking how to pay a specific invoice should fetch the QR payment string',
    'Jak zaplatím fakturu číslo 12? Chci QR kód.',
    'get_payment_qr',
    (input) =>
      num(input.invoiceId) === 12 ? null : `Expected invoiceId 12, got ${input.invoiceId}`
  ),
  paramScenario(
    'report-payment',
    'customer',
    'Reporting a completed bank transfer should call request_payment',
    'Už jsem fakturu 7 zaplatil převodem, dej vědět dodavateli.',
    'request_payment',
    (input) => (num(input.invoiceId) === 7 ? null : `Expected invoiceId 7, got ${input.invoiceId}`)
  ),
  simpleScenario(
    'recommendations-cs',
    'customer',
    'A customer asking what to have should use recommendations',
    'Nevím co si dát, co mi doporučíš?',
    'get_recommendations',
    ['list_products']
  ),

  // ── Supplier: stocking ──────────────────────────────────────────────────────
  paramScenario(
    'add-stock',
    'supplier',
    'Restocking with product, pieces and price stated should call add_stock',
    'Naskladni 24 kusů produktu 5 po 18 korunách.',
    'add_stock',
    (input) => {
      if (num(input.productId) !== 5) return `Expected productId 5, got ${input.productId}`
      if (num(input.amount) !== 24) return `Expected amount 24, got ${input.amount}`
      if (num(input.price) !== 18) return `Expected price 18, got ${input.price}`
      return null
    }
  ),
  paramScenario(
    'explicit-stock-is-direct',
    'supplier',
    'Product, pieces, selling and purchase price stated by the user → add_stock, not a draft',
    'Naskladni 12 Coca Col (produkt 7) za 25 Kč, nákupka 19,90.',
    'add_stock',
    (input) => {
      if (num(input.productId) !== 7) return `Expected productId 7, got ${input.productId}`
      if (num(input.amount) !== 12) return `Expected amount 12, got ${input.amount}`
      if (num(input.price) !== 25) return `Expected price 25, got ${input.price}`
      if (Math.abs(num(input.purchasePrice) - 19.9) > 0.001) {
        return `Expected purchasePrice 19.9, got ${input.purchasePrice}`
      }
      return null
    }
  ),
  {
    id: 'receipt-to-draft',
    role: 'supplier',
    description: 'A receipt with several products should become a stocking draft',
    userMessage:
      'Tady je účtenka z Lidlu: PEPSI 0,33 PLECH 24 ks po 14,90, MONSTER ENERGY 0,5 12 ks ' +
      'po 24,90. Připrav naskladnění.',
    expectedTool: 'create_stock_draft',
    // Matching the receipt lines to the catalogue first is the documented first step.
    allowedTools: ['list_catalog_products'],
    source: 'synthetic',
    validate: (toolCall) => {
      const check = expectTool(toolCall, 'create_stock_draft', ['list_catalog_products'])
      if (!check.ok) return { passed: false, reason: check.reason }
      if (toolCall!.name === 'list_catalog_products') {
        return { passed: true, reason: 'Matches the receipt lines to the catalogue first' }
      }
      const items = toolCall!.input.items as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(items) || items.length !== 2) {
        return { passed: false, reason: `Expected 2 items, got ${items?.length ?? 0}` }
      }
      const amounts = items.map((item) => Number(item.amount)).sort((a, b) => a - b)
      if (amounts[0] !== 12 || amounts[1] !== 24) {
        return { passed: false, reason: `Unexpected amounts ${amounts.join(', ')}` }
      }
      return { passed: true, reason: 'Correct' }
    },
  },
  simpleScenario(
    'single-receipt-line-is-draft',
    'supplier',
    'Even a one-line receipt is inferred data → a draft for review, never add_stock',
    'Tady je účtenka: COCA COLA 0,5 12 ks á 19,90. Naskladni.',
    'create_stock_draft',
    ['list_catalog_products']
  ),
  simpleScenario(
    'low-stock-check',
    'supplier',
    'Asking what is running low should check the stock overview',
    'Co v lednici dochází a měl bych dokoupit?',
    'get_stock',
    ['list_products']
  ),
  simpleScenario(
    'find-product-in-catalog',
    'supplier',
    'Finding a product to restock should search the catalog (incl. out-of-stock)',
    'Najdi v katalogu produkt s čárovým kódem 8590121052023.',
    'list_catalog_products',
    ['list_products']
  ),
  simpleScenario(
    'recent-lots',
    'supplier',
    'Asking about own lots of one product this month is a delivery-level question',
    'Kolik Pepsi jsem naskladnil tenhle měsíc a za kolik?',
    'recent_deliveries',
    ['get_stock', 'list_catalog_products']
  ),
  paramScenario(
    'rename-product',
    'supplier',
    'Renaming a product should update its metadata',
    'Přejmenuj produkt 5 na „Pepsi Max 0,33 l“.',
    'update_product',
    (input) => {
      if (num(input.productId) !== 5) return `Expected productId 5, got ${input.productId}`
      if (!String(input.displayName ?? '').includes('Pepsi Max')) {
        return `Expected displayName with "Pepsi Max", got "${input.displayName}"`
      }
      return null
    }
  ),

  // ── Supplier: drafts from chat ──────────────────────────────────────────────
  simpleScenario(
    'draft-fix-line',
    'supplier',
    'Fixing a draft line is read-modify-write: read the draft first (or update it directly)',
    'V příjemce 12 je ta třetí položka Monster Mango, produkt 44. Oprav to.',
    'get_stock_draft',
    ['update_stock_draft']
  ),
  simpleScenario(
    'open-drafts',
    'supplier',
    'Asking about unfinished drafts should list the open ones',
    'Mám tam nějaké rozpracované příjemky?',
    'list_stock_drafts'
  ),
  paramScenario(
    'discard-draft',
    'supplier',
    'Throwing a draft away that was stocked by hand should discard it',
    'Příjemku 9 zahoď, naskladnil jsem to ručně.',
    'discard_stock_draft',
    (input) => (num(input.draftId) === 9 ? null : `Expected draftId 9, got ${input.draftId}`)
  ),
  paramScenario(
    'commit-reviewed-draft',
    'supplier',
    'An explicit "stock it" after review commits the draft (reading it first is fine)',
    'Příjemku 12 jsem zkontroloval, všechno sedí. Naskladni ji.',
    'commit_stock_draft',
    (input) => (num(input.draftId) === 12 ? null : `Expected draftId 12, got ${input.draftId}`),
    ['get_stock_draft']
  ),

  // ── Supplier: stock out ─────────────────────────────────────────────────────
  paramScenario(
    'write-off-expired',
    'supplier',
    'Throwing away expired pieces is a write-off with a reason',
    'Vyhodil jsem 3 prošlé tyčinky (produkt 10).',
    'write_off_stock',
    (input) => {
      if (num(input.productId) !== 10) return `Expected productId 10, got ${input.productId}`
      if (num(input.quantity) !== 3) return `Expected quantity 3, got ${input.quantity}`
      if (input.reason !== 'expired') return `Expected reason "expired", got "${input.reason}"`
      return null
    }
  ),
  paramScenario(
    'void-duplicate-lot',
    'supplier',
    'A lot stocked twice by mistake is voided (looking it up first is fine)',
    'Naskladnil jsem dodávku 88 omylem dvakrát, zruš ji.',
    'void_delivery',
    (input) =>
      num(input.deliveryId) === 88 ? null : `Expected deliveryId 88, got ${input.deliveryId}`,
    ['recent_deliveries']
  ),
  paramScenario(
    'correct-lot-price',
    'supplier',
    'A mistyped selling price on a lot is corrected, not re-stocked',
    'U dodávky 55 jsem dal cenu 18, má být 28. Oprav to.',
    'correct_delivery',
    (input) => {
      if (num(input.deliveryId) !== 55) return `Expected deliveryId 55, got ${input.deliveryId}`
      if (num(input.price) !== 28) return `Expected price 28, got ${input.price}`
      return null
    },
    ['recent_deliveries']
  ),
  simpleScenario(
    'inventory-dictated',
    'supplier',
    'A dictated shelf count needs the system stock first (expected), then the count',
    'Spočítal jsem lednici: 5 kofol, 2 pepsi.',
    'get_stock',
    ['record_inventory_count']
  ),
  paramScenario(
    'classify-count-loss',
    'supplier',
    'Explaining the shortfall of a past count classifies the loss',
    'U inventury 4 ty chybějící kofoly (produkt 7) byly prošlé.',
    'classify_inventory_loss',
    (input) => {
      if (num(input.countId) !== 4) return `Expected countId 4, got ${input.countId}`
      if (num(input.productId) !== 7) return `Expected productId 7, got ${input.productId}`
      if (input.reason !== 'expired') return `Expected reason "expired", got "${input.reason}"`
      return null
    }
  ),

  // ── Supplier: planning ──────────────────────────────────────────────────────
  simpleScenario(
    'shopping-list-cs',
    'supplier',
    'Planning a shopping trip should ask for the shopping list',
    'Jdu zítra nakupovat do lednice, co mám koupit a kolik?',
    'get_shopping_list',
    ['get_stock']
  ),
  simpleScenario(
    'supplier-what-to-buy-vs-recommendations',
    'supplier',
    'A supplier asking what to buy for the trip wants the shopping list, not personal picks',
    'Jsem dodavatel, zítra jedu nakoupit. Nevím co, co mi doporučíš?',
    'get_shopping_list'
  ),
  paramScenario(
    'shopping-list-week',
    'supplier',
    'A longer gap until the next trip is a horizon override',
    'Co nakoupit, když příště pojedu až za 10 dní?',
    'get_shopping_list',
    (input) =>
      num(input.horizonDays) === 10 ? null : `Expected horizonDays 10, got ${input.horizonDays}`
  ),
  simpleScenario(
    'shopping-list-edit-line',
    'supplier',
    'Buying fewer pieces than suggested edits the saved list line',
    'Na nákupním seznamu koupím jen 12 pepsi místo 24, uprav to.',
    'update_shopping_list_line',
    ['get_shopping_list']
  ),
  simpleScenario(
    'shopping-list-add-line',
    'supplier',
    "A colleague's wish goes onto the shopping list as a new line",
    'Přidej na nákupní seznam chipsy, Petr je chtěl.',
    'add_shopping_list_line',
    ['list_catalog_products', 'get_shopping_list']
  ),
  paramScenario(
    'add-to-existing-group',
    'supplier',
    'Adding one product to an existing group goes through update_product (or the upsert)',
    'Přidej Monster Mango (produkt 44) do skupiny Energy s cukrem (skupina 3).',
    'update_product',
    (input) => {
      if (num(input.productId) !== 44) return `Expected productId 44, got ${input.productId}`
      if (num(input.groupId) !== 3) return `Expected groupId 3, got ${input.groupId}`
      return null
    },
    ['create_product_group']
  ),
  paramScenario(
    'new-group-with-members',
    'supplier',
    'A new group with members is created in one call',
    'Založ nákupní skupinu Tyčinky v kategorii 2 a dej do ní produkty 10, 11, 12.',
    'create_product_group',
    (input) => {
      const ids = input.productIds
      if (!Array.isArray(ids) || ids.length !== 3) {
        return `Expected 3 productIds, got ${Array.isArray(ids) ? ids.length : 'none'}`
      }
      return null
    }
  ),

  // ── Supplier: earnings ──────────────────────────────────────────────────────
  paramScenario(
    'earnings-this-year',
    'supplier',
    "Asking about this year's earnings and the limit is the finance summary",
    'Kolik jsem letos na lednici vydělal a kolik mi zbývá do limitu?',
    'get_finance_summary',
    (input) => {
      if (input.year === undefined || input.year === null) return null
      const year = new Date().getFullYear()
      return num(input.year) === year ? null : `Expected year ${year} or none, got ${input.year}`
    }
  ),
  simpleScenario(
    'shrinkage-by-reason',
    'supplier',
    'Asking what went missing and why is the finance summary (shrinkage by reason)',
    'Kolik mi letos zmizelo věcí a proč?',
    'get_finance_summary'
  ),

  // ── Supplier: invoicing ─────────────────────────────────────────────────────
  simpleScenario(
    'who-owes-me',
    'supplier',
    'Asking who owes money should use the uninvoiced summary',
    'Kdo mi ještě dluží za nákupy, co jsem nevyfakturoval?',
    'uninvoiced_summary',
    ['list_issued_invoices']
  ),
  simpleScenario(
    'monthly-billing',
    'supplier',
    'Monthly billing run: preview first is preferred, generating directly is accepted',
    'Vyfakturuj všem jejich nákupy za tenhle měsíc.',
    'generate_invoices',
    ['uninvoiced_summary']
  ),
  simpleScenario(
    'billing-needs-preview',
    'supplier',
    'A terse "invoice everyone" should preview who owes what before generating',
    'Vyfakturuj všem.',
    'uninvoiced_summary',
    ['generate_invoices']
  ),
  paramScenario(
    'confirm-payment',
    'supplier',
    'Confirming a received payment should call approve_payment',
    'Platba za fakturu 33 mi přišla na účet, potvrď ji.',
    'approve_payment',
    (input) =>
      num(input.invoiceId) === 33 ? null : `Expected invoiceId 33, got ${input.invoiceId}`
  ),
  paramScenario(
    'reject-payment',
    'supplier',
    'A payment that never arrived is rejected',
    'Platba za fakturu 41 nedorazila, zamítni ji.',
    'reject_payment',
    (input) =>
      num(input.invoiceId) === 41 ? null : `Expected invoiceId 41, got ${input.invoiceId}`
  ),
  simpleScenario(
    'pending-confirmations',
    'supplier',
    'Asking which payments wait for confirmation should filter issued invoices',
    'Které platby čekají na moje potvrzení?',
    'list_issued_invoices'
  ),

  // ── Admin ───────────────────────────────────────────────────────────────────
  simpleScenario(
    'admin-overview',
    'admin',
    'Asking for an overall status should fetch dashboard stats',
    'Dej mi celkový přehled, jak si lednice vede.',
    'dashboard_stats'
  ),
  paramScenario(
    'disable-user',
    'admin',
    'Disabling a user account should call update_user with isDisabled',
    'Zablokuj uživatelský účet číslo 8.',
    'update_user',
    (input) => {
      if (num(input.userId) !== 8) return `Expected userId 8, got ${input.userId}`
      if (input.isDisabled !== true) return 'Expected isDisabled: true'
      return null
    }
  ),
  paramScenario(
    'storno-order',
    'admin',
    'Cancelling an order should call storno_order',
    'Stornuj objednávku 101, byl to omyl.',
    'storno_order',
    (input) => (num(input.orderId) === 101 ? null : `Expected orderId 101, got ${input.orderId}`)
  ),
  simpleScenario(
    'audit-question',
    'admin',
    'Asking who changed something should query the audit log',
    'Kdo naposledy měnil role uživatelů?',
    'get_audit_logs',
    ['list_users']
  ),
]
