import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type GetPromptResult } from '@modelcontextprotocol/sdk/types.js'
import type User from '#models/user'

/**
 * The role-aware workflow reference served as the `workflow` prompt. Exported so the eval
 * harness can measure tool selection with and without it. Clients do not load prompts on
 * their own — the tool descriptions must stand alone; this is the long form.
 */
export function buildWorkflowGuide(isSupplier: boolean, isAdmin: boolean): string {
  const s: string[] = []

  s.push('FRIDGORA MCP — WORKFLOW REFERENCE')
  s.push('Load once per session. Exact tool names, param names, sequences, and error codes.')
  s.push('')
  s.push('DOMAIN: an office fridge. Suppliers stock drinks/snacks, colleagues buy them with')
  s.push('one click and pay LATER via bank transfer: Order → Invoice (batch) → Payment.')
  s.push('All prices are in CZK. Times are ISO 8601 with offset (Europe/Prague).')
  s.push('')

  // ── Shopping (all users) ────────────────────────────────────────────────
  s.push('## SHOPPING (all authenticated users)')
  s.push('')
  s.push('### Browse the shop')
  s.push('  list_products(showOutOfStock?:boolean)')
  s.push('  → {products:[{productId, displayName, description, category, allergens[],')
  s.push('     stockSum, price, deliveryId, isFavorite}], count}')
  s.push('  price/deliveryId come from the delivery lot sold next (strict FIFO, oldest first).')
  s.push('  Results already respect the user’s allergen preferences; favorites sort first.')
  s.push('')
  s.push('### Buy (1-click, pay later)')
  s.push(
    '  buy_product(deliveryId?:number, productId?:number, quantity?:1..10, expectedPrice?:number)'
  )
  s.push('  ↳ Pass deliveryId from list_products when you have it; productId alone also works')
  s.push('    (the oldest in-stock lot is used). One order row per piece.')
  s.push('  → {orderIds[], purchased, unitPrice, totalCost}')
  s.push('  ↳ Pass expectedPrice = the price you told the user; a different price → PRICE_CHANGED.')
  s.push('  Errors: OUT_OF_STOCK, PRICE_CHANGED (list the product again, confirm the new price).')
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
  s.push('  get_recommendations(limit?:1..12) → products the user typically buys FOR THEMSELVES.')
  s.push('  Not for restocking the fridge — that is get_shopping_list (suppliers).')
  s.push('')

  // ── Payments (all users) ────────────────────────────────────────────────
  s.push('## INVOICES & PAYMENTS (all authenticated users)')
  s.push('')
  s.push('  INVOICE LIFECYCLE (buyer perspective — invoices you RECEIVED)')
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
    s.push('### DECIDING (supplier)')
    s.push('  user states product + pieces + price, wants it now     → add_stock')
    s.push(
      '  receipt / photo / list you inferred / >1 product / unsure → create_stock_draft, then send reviewUrl'
    )
    s.push('  "what is in the fridge / running out / sells"           → get_stock')
    s.push(
      '  "which lot did I stock / void a lot"                     → recent_deliveries → void_delivery'
    )
    s.push(
      '  "fix the pieces or price of a lot"                       → recent_deliveries → correct_delivery'
    )
    s.push(
      '  "what did you put in the draft / fix line 3"             → get_stock_draft → update_stock_draft'
    )
    s.push('  "stock the draft" (after the user saw the lines)         → commit_stock_draft')
    s.push(
      '  "what should I buy for the fridge"                       → get_shopping_list (NOT get_recommendations)'
    )
    s.push('  "what should I eat/drink"                                → get_recommendations')
    s.push('  "buy only 12, not 24" / "skip that line"                 → update_shopping_list_line')
    s.push('  "add X to the shopping list"                             → add_shopping_list_line')
    s.push('  "pieces are gone and I know why"                         → write_off_stock')
    s.push(
      '  "I counted the shelf"                                    → get_stock first, then record_inventory_count'
    )
    s.push('  "the missing pieces were expired/stolen"                 → classify_inventory_loss')
    s.push(
      '  "invoice everyone"                                       → uninvoiced_summary, confirm, generate_invoices'
    )
    s.push('  Never create_product from receipt text; never guess an id.')
    s.push('')
    s.push('### GLOSSARY (Czech → tool, and units)')
    s.push(
      '  naskladnit = add_stock / create_stock_draft · příjemka = stocking draft (*_stock_draft)'
    )
    s.push('  odepsat = write_off_stock · inventura = record_inventory_count · manko = shrinkage')
    s.push('  stornovat dodávku = void_delivery · opravit dodávku = correct_delivery')
    s.push(
      '  vyfakturovat = generate_invoices · marže = marginPercent · nákupní seznam = get_shopping_list'
    )
    s.push('  "Naskladnit" (Stock) = the web button that commits a draft')
    s.push('  amount = pieces in a lot · quantity = pieces in a purchase / write-off / list line')
    s.push(
      '  price = selling price, whole CZK · purchasePrice / unitCost = paid per piece, 2 decimals'
    )
    s.push('  scope "all" = the whole fridge (Celá lednice) · "mine" = only my lots (Jen moje)')
    s.push('  lossRate 0–1 · *Percent = percentages')
    s.push('')
    s.push('### Catalog')
    s.push(
      '  list_catalog_products(search?, categoryId?, page?, perPage?)  ← includes out-of-stock, groupId'
    )
    s.push(
      '  create_product(displayName, categoryId, description?, barcode?, allergenIds?, groupId?)'
    )
    s.push('  ↳ idempotent by name; WITHOUT an image (web UI adds it later); only after the')
    s.push('    catalog search found nothing AND the user confirmed the product is new.')
    s.push('  update_product(productId, displayName?, description?, categoryId?, barcode?,')
    s.push('    allergenIds?, groupId?: id|null) → {changes}')
    s.push('  Errors: PRODUCT_NOT_FOUND, CATEGORY_NOT_FOUND, GROUP_NOT_FOUND.')
    s.push('')
    s.push('### Stocking one lot (the user dictates product, pieces, price)')
    s.push(
      '  add_stock(productId, amount, price?, purchasePrice?, confirmWarnings?)  ← creates a delivery lot'
    )
    s.push('  ↳ price = selling price in whole CZK; purchasePrice = what was paid per piece.')
    s.push('    Give at least one; without price it is purchasePrice + your margin.')
    s.push('  ↳ The result may say stocked:false with warnings (duplicate within 30 min, unusual')
    s.push('    price). Show them; repeat with confirmWarnings:true ONLY if the user confirms.')
    s.push('  Errors: PRICE_REQUIRED, PRODUCT_NOT_FOUND.')
    s.push('')
    s.push('### Stocking from a receipt (a draft the supplier reviews)')
    s.push('  1. Read the receipt (photo/text): product lines, pieces, price per piece.')
    s.push('  2. list_catalog_products(search) to match each line; only set productId when sure.')
    s.push('  3. create_stock_draft(note?, items:[{label?, productId?, groupId?, amount,')
    s.push(
      '     purchasePrice?, price?}]) → {draftId, unmatched, problems, reviewUrl}. NOTHING is stocked.'
    )
    s.push(
      '  4. Send the supplier reviewUrl: they fix unmatched lines and press "Naskladnit" (Stock).'
    )
    s.push('  5. From chat: get_stock_draft(draftId) shows the lines; update_stock_draft(draftId,')
    s.push('     items) replaces ALL of them; discard_stock_draft(draftId) throws it away;')
    s.push('     commit_stock_draft(draftId, confirmWarnings?) stocks it — only after the user saw')
    s.push('     the lines and said so. list_stock_drafts() lists the open ones.')
    s.push('  ↳ Multipacks: divide the pack price by its pieces (6× for 89.90 → 14.98 per piece).')
    s.push('  Errors: DRAFT_NOT_FOUND, DRAFT_CLOSED, DRAFT_EMPTY, DRAFT_INCOMPLETE (a line has no')
    s.push('  product or no price), NEEDS_CONFIRMATION (see add_stock warnings).')
    s.push('')
    s.push('### Watching the stock')
    s.push(
      '  get_stock(scope?:"all"|"mine", stockState?:"all"|"low"|"out", categoryId?, page?, perPage?)'
    )
    s.push('  → {totals, lowStockCount, lowStockItems[], outOfStockCount, topMovers[], products[]}')
    s.push('  recent_deliveries(productId?, scope?:"mine"|"all", includeVoided?, page?, perPage?)')
    s.push('  → {deliveries:[{deliveryId, product, amountSupplied, amountLeft, amountLost, price,')
    s.push('     purchasePrice, corrections, voided, createdAt}]}')
    s.push('')
    s.push('### Stock out: losses, counts, fixing lots')
    s.push(
      '  write_off_stock(productId, quantity, reason:"expired"|"damaged"|"stolen"|"other", note?)'
    )
    s.push('  ↳ known losses; off the oldest lots first (FIFO). Errors: NOT_ENOUGH_STOCK.')
    s.push(
      '  record_inventory_count(scope:"mine"|"all", note?, items:[{productId, expected, counted}])'
    )
    s.push('  ↳ expected = get_stock totalRemaining BEFORE the user dictates. Shortfall is written')
    s.push(
      '    off without a reason; classify_inventory_loss(countId, productId, reason) adds one.'
    )
    s.push('  void_delivery(deliveryId, reason)  ← a lot nothing sold from (duplicate add_stock)')
    s.push('  correct_delivery(deliveryId, amount, price, purchasePrice?, reason)  ← pieces down,')
    s.push('    prices changed; uninvoiced purchases from the lot are repriced.')
    s.push('  Errors: DELIVERY_NOT_FOUND, DELIVERY_VOIDED, DELIVERY_HAS_ORDERS, AMOUNT_BELOW_SOLD,')
    s.push('  AMOUNT_INCREASE_NOT_ALLOWED (extra pieces = new lot via add_stock), NO_CHANGE.')
    s.push('')
    s.push('### Shopping list (what to buy FOR THE FRIDGE, how much, for how much)')
    s.push('  get_shopping_list(horizonDays?, scope?:"mine"|"all", categoryIds?)')
    s.push(
      '  → {settings, totals, lines:[{key, kind, name, quantity, stock, daysOfCover, unitCost,'
    )
    s.push('     goodPrice, hints[]}], enoughStock[]}')
    s.push('  ↳ kind "group" = a purchase group: any product of it will do; hints = best sellers.')
    s.push(
      '    Overrides do not save. Edits DO: update_shopping_list_line(key, quantity?, unitCost?,'
    )
    s.push(
      '    isChecked?, isRemoved?, note?) · add_shopping_list_line(productId?|label, quantity, …)'
    )
    s.push('  list_product_groups() / create_product_group(name, categoryId, note?, productIds?)')
    s.push('  ↳ an existing group of that name is reused and the products are added to it.')
    s.push('  Errors: LINE_NOT_FOUND, GROUP_NAME_TAKEN, GROUP_NOT_FOUND.')
    s.push('')
    s.push('### Earnings')
    s.push('  get_finance_summary(year?) → revenue, costOfSales, grossProfit, ownConsumption,')
    s.push('  shrinkage {lostUnits, surplusUnits, lossCost, lossValue, lossRate, byReason[]},')
    s.push('  netProfit, achievedMarginPercent, breakEvenMarginPercent, incomeLimit')
    s.push('  ↳ Only sales to OTHER people count. What the supplier bought from their own lots is')
    s.push('    ownConsumption {units, value}: not revenue, not profit, not in the yearly limit.')
    s.push('  ↳ lossCost = shrinkage at purchase prices (what net profit subtracts);')
    s.push('    lossValue = at selling prices. Past the limit there is only a warning.')
    s.push('')
    s.push('### Invoicing flow (monthly billing run)')
    s.push('  1. uninvoiced_summary() → {buyers:[{buyerId, buyerName, orderCount, totalCost}]}')
    s.push('     Show it and confirm with the user — step 2 e-mails people and cannot be undone.')
    s.push('  2. generate_invoices(buyerId?) → one invoice per buyer (or just one buyer)')
    s.push('  3. list_issued_invoices(status?:"awaiting") → payments waiting for confirmation')
    s.push('  4. approve_payment(invoiceId) or reject_payment(invoiceId)')
    s.push('  Errors: ALREADY_PAID, FORBIDDEN.')
    s.push('')
  }

  if (isAdmin) {
    s.push('## ADMIN (you have admin access)')
    s.push('')
    s.push('  dashboard_stats() → global overview.')
    s.push('  list_users(role?, disabled?, page?, perPage?)')
    s.push('  update_user(userId, role?, isDisabled?, keypadId?)')
    s.push(
      '  Errors: LAST_ACTIVE_ADMIN_REQUIRED, USER_HAS_UNINVOICED_ORDERS, KEYPAD_ID_TAKEN, KEYPAD_ID_RESERVED.'
    )
    s.push(
      '  ↳ Before disabling a user with debts: generate_invoices_for_user(buyerId) — ALL their'
    )
    s.push('    debts across every supplier (generate_invoices(buyerId) is only your own sales) —')
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
  s.push('  - Never invent IDs — always resolve them via a list_* or get_* tool first.')
  s.push('  - ID TYPES: productId = catalog item; deliveryId = one stock lot of a product;')
  s.push('    draftId = a stocking draft; countId = an inventory count; invoiceId = a batch of')
  s.push('    orders billed to one buyer; orderId = one purchased piece; groupId = purchase group;')
  s.push('    key (g-/p-/c-<id>) = a shopping-list line.')
  s.push(
    '  - Tool errors return isError with "(error code: X)" and a hint; explain it to the user.'
  )
  s.push('  - A result with stocked:false and warnings changed nothing — confirm with the user')
  s.push('    before repeating with confirmWarnings:true.')
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
