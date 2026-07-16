import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type GetPromptResult } from '@modelcontextprotocol/sdk/types.js'
import type User from '#models/user'

function buildWorkflowGuide(isSupplier: boolean, isAdmin: boolean): string {
  const s: string[] = []

  s.push('SMALL BUSINESS FRIDGE MCP — WORKFLOW REFERENCE')
  s.push('Load once per session. Exact tool names, param names, sequences, and error codes.')
  s.push('')
  s.push('DOMAIN: an office fridge. Suppliers stock drinks/snacks, colleagues buy them with')
  s.push('one click and pay LATER via bank transfer: Order → Invoice (batch) → Payment.')
  s.push('All prices are in CZK.')
  s.push('')

  // ── Shopping (all users) ────────────────────────────────────────────────
  s.push('## SHOPPING (all authenticated users)')
  s.push('')
  s.push('### Browse the shop')
  s.push('  list_products(showOutOfStock?:boolean)')
  s.push('  → {products:[{productId, displayName, description, category, allergens[],')
  s.push('     stockSum, price, deliveryId, isFavorite}], count}')
  s.push('  price/deliveryId come from the cheapest in-stock delivery lot.')
  s.push('  Results already respect the user’s allergen preferences; favorites sort first.')
  s.push('')
  s.push('### Buy (1-click, pay later)')
  s.push('  buy_product(deliveryId?:number, productId?:number, quantity?:1..10)')
  s.push('  ↳ Pass deliveryId from list_products when you have it; productId alone also works')
  s.push('    (cheapest in-stock lot is chosen). One order row per unit.')
  s.push('  → {orderIds[], purchased, unitPrice, totalCost}')
  s.push('  Errors: OUT_OF_STOCK.')
  s.push('  Examples:')
  s.push('    "kup mi kofolu" → list_products() → find Kofola → buy_product(deliveryId:X)')
  s.push('    "vezmu si 3 tyčinky" → buy_product(productId:Y, quantity:3)')
  s.push('')
  s.push('### Order history')
  s.push('  get_my_orders(page?, perPage?, invoiced?:"yes"|"no")')
  s.push(
    '  → {meta, orders:[{orderId, product, supplier, price, channel, invoiced, invoiceId, createdAt}]}'
  )
  s.push('')
  s.push('### Recommendations')
  s.push('  get_recommendations(limit?:1..12) → products the user typically buys.')
  s.push('')

  // ── Payments (all users) ────────────────────────────────────────────────
  s.push('## INVOICES & PAYMENTS (all authenticated users)')
  s.push('')
  s.push('  INVOICE LIFECYCLE (buyer perspective)')
  s.push('    unpaid   → you owe the supplier; pay via bank transfer')
  s.push('    awaiting → you reported the payment (request_payment); supplier must confirm')
  s.push('    paid     → supplier confirmed the payment')
  s.push('')
  s.push('  get_my_invoices(status?:"paid"|"unpaid"|"awaiting", page?, perPage?)')
  s.push('  → {meta, invoices:[{invoiceId, supplier, totalCost, status, orderCount, createdAt}]}')
  s.push('')
  s.push('  get_payment_qr(invoiceId) → {amount, iban, receiver, spdCode}')
  s.push('  spdCode is a Czech SPD payment string — render as QR or read out the IBAN+amount.')
  s.push('')
  s.push('  request_payment(invoiceId)        → status becomes "awaiting"')
  s.push('  cancel_payment_request(invoiceId) → status back to "unpaid"')
  s.push('  Errors: FORBIDDEN (not your invoice), ALREADY_PAID.')
  s.push('')
  s.push('  TYPICAL PAYMENT FLOW: get_my_invoices(status:"unpaid") → get_payment_qr(id)')
  s.push('  → user pays in their bank → request_payment(id).')
  s.push('')

  if (isSupplier) {
    s.push('## SUPPLIER (you have supplier access)')
    s.push('')
    s.push('### Stocking flow')
    s.push(
      '  list_catalog_products(search?, categoryId?, page?, perPage?)  ← includes out-of-stock'
    )
    s.push('  create_product(displayName, categoryId, description?, barcode?, allergenIds?)')
    s.push('  ↳ idempotent by name; product is created WITHOUT an image (web UI can add it later)')
    s.push('  add_stock(productId, amount:1..1000, price)  ← creates a delivery lot')
    s.push('  get_stock(scope?:"store"|"mine", categoryId?, page?, perPage?)')
    s.push('  → {totals, lowStockItems[], outOfStockCount, topMovers[], products[]}')
    s.push('  recent_deliveries(productId?, page?, perPage?)')
    s.push('')
    s.push('### Invoicing flow (monthly billing run)')
    s.push('  1. uninvoiced_summary() → {buyers:[{buyerId, buyerName, orderCount, totalCost}]}')
    s.push('  2. generate_invoices(buyerId?) → one invoice per buyer (or just one buyer)')
    s.push('     Buyers get an email with QR payment instructions automatically.')
    s.push('  3. list_issued_invoices(status?:"awaiting") → payments waiting for confirmation')
    s.push('  4. approve_payment(invoiceId) or reject_payment(invoiceId)')
    s.push('')
    s.push('  ID TYPES: productId = catalog item; deliveryId = a stock lot of a product;')
    s.push('  invoiceId = a batch of orders billed to one buyer.')
    s.push('')
  }

  if (isAdmin) {
    s.push('## ADMIN (you have admin access)')
    s.push('')
    s.push('  dashboard_stats() → global overview.')
    s.push('  list_users(role?, disabled?, page?, perPage?)')
    s.push('  update_user(userId, role?, isDisabled?, keypadId?)')
    s.push('  Errors: LAST_ACTIVE_ADMIN_REQUIRED, USER_HAS_UNINVOICED_ORDERS, KEYPAD_ID_TAKEN.')
    s.push('  ↳ Before disabling a user with debts: generate_invoices_for_user(buyerId),')
    s.push('    wait until invoices are paid, then update_user(userId, isDisabled:true).')
    s.push('')
    s.push('  list_all_orders(buyerId?, supplierId?, channel?, invoiced?, page?, perPage?)')
    s.push('  list_all_invoices(buyerId?, supplierId?, status?, page?, perPage?)')
    s.push('  storno_order(orderId) — restores stock; only for NOT-yet-invoiced orders')
    s.push('  Errors: ORDER_ALREADY_INVOICED.')
    s.push('  create_category(name, color:"#rrggbb")')
    s.push('  get_audit_logs(action?, entityType?, userId?, page?, perPage?)')
    s.push('')
  }

  s.push('## GENERAL RULES')
  s.push('  - Never invent IDs — always resolve them via a list_* tool first.')
  s.push('  - Tool errors return isError with a code in parentheses; explain it to the user.')
  s.push('  - Money amounts are numbers in CZK; do not convert currencies.')
  s.push('  - Pagination: page starts at 1; meta.{total, perPage, currentPage, lastPage}.')

  return s.join('\n')
}

export function registerPrompts(server: McpServer, user: User): void {
  // Admin implicitly has supplier access (mirrors role_middleware)
  const isSupplier = user.role === 'supplier' || user.role === 'admin'
  const isAdmin = user.role === 'admin'

  server.prompt(
    'workflow',
    'Complete workflow reference: tool sequences, exact parameter names, error codes, and constraints. ' +
      'Load once at session start to avoid trial-and-error.',
    (): GetPromptResult => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: buildWorkflowGuide(isSupplier, isAdmin),
          },
        },
      ],
    })
  )
}
