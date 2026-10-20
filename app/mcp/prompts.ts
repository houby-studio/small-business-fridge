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
  s.push(
    '  request_payment(invoiceId)        → status becomes "awaiting"; the supplier is e-mailed'
  )
  s.push('  cancel_payment_request(invoiceId) → status back to "unpaid"; the supplier is e-mailed')
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
      '  "what did you put in the draft / fix line 3"             → get_stock_draft → update_stock_draft(lines)'
    )
    s.push('  "stock the draft" (after the user saw the lines)         → commit_stock_draft')
    s.push(
      '  "what should I buy for the fridge"                       → get_shopping_list (NOT get_recommendations)'
    )
    s.push('  "what should I eat/drink"                                → get_recommendations')
    s.push('  "buy only 12, not 24" / "skip that line"                 → update_shopping_list_line')
    s.push('  "add X to the shopping list"                             → add_shopping_list_line')
    s.push('  "I am back from shopping" (list → receipt)               → complete_shopping_list')
    s.push('  "pieces are gone and I know why"                         → write_off_stock')
    s.push(
      '  "that write-off was a mistake"                           → list_stock_adjustments → revert_write_off'
    )
    s.push('  "sell the rest cheaper / raise the price"                → reprice_stock')
    s.push(
      '  "I counted the shelf"                                    → record_inventory_count (counted only)'
    )
    s.push('  "the missing pieces were expired/stolen"                 → classify_inventory_loss')
    s.push('  "what did I write off / which count"                     → list_stock_adjustments')
    s.push(
      '  "what earns most / loses money"                          → get_finance_summary(byProduct)'
    )
    s.push(
      '  "invoice everyone"                                       → uninvoiced_summary, confirm, generate_invoices(expectedTotal)'
    )
    s.push(
      '  "Petr paid me" (an invoice you ISSUED)                   → approve_payment; "I paid Marie" → request_payment'
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
      '  list_catalog_products(search?, categoryId?, includeArchived?, page?, perPage?)  ← out-of-stock too'
    )
    s.push(
      '  create_product(displayName, categoryId, description?, barcode?, allergens?, groupId?)'
    )
    s.push('  ↳ idempotent by name or barcode (existed:true, matchedBy); WITHOUT an image (web UI')
    s.push('    adds it later); only after the catalog search found nothing AND the user')
    s.push('    confirmed the product is new. allergens = names, e.g. ["Lepek","Mléko"].')
    s.push('  update_product(productId, displayName?, description?, categoryId?, barcode?,')
    s.push('    allergens?, groupId?: id|null) → {changes}')
    s.push('  Errors: PRODUCT_NOT_FOUND, CATEGORY_NOT_FOUND, GROUP_NOT_FOUND, BARCODE_TAKEN,')
    s.push('  ALLERGEN_NOT_FOUND (the message lists the valid names).')
    s.push('')
    s.push('### Stocking one lot (the user dictates product, pieces, price)')
    s.push(
      '  add_stock(productId, amount, price?, purchasePrice?, confirmWarnings?)  ← creates a delivery lot'
    )
    s.push('  ↳ price = selling price in whole CZK; purchasePrice = what was paid per piece.')
    s.push('    Give at least one; without price it is purchasePrice + your margin, never below')
    s.push("    the product's current price.")
    s.push('  ↳ The result may say stocked:false with warnings (duplicate within 30 min, unusual')
    s.push('    selling or purchase price). Show them; repeat with confirmWarnings:true ONLY if')
    s.push('    the user confirms.')
    s.push('  Errors: PRICE_REQUIRED, PRODUCT_NOT_FOUND.')
    s.push('')
    s.push('### Stocking from a receipt (a draft the supplier reviews)')
    s.push('  A supplier has ONE open draft. The web, a finished shopping list and you all add')
    s.push('  lines to it; every line carries source "web" | "shopping_list" | "assistant".')
    s.push('  1. Read the receipt (photo/text): product lines, pieces, price per piece.')
    s.push('  2. list_catalog_products(search) to match each line; only set productId when sure.')
    s.push('  3. create_stock_draft(note?, items:[{label?, productId?, groupId?, amount,')
    s.push('     purchasePrice?, price?}]) → adds the lines to the open draft (created when none):')
    s.push(
      '     {draftId, added, created, unmatched, problems, reviewUrl, items[].source}. NOTHING is stocked.'
    )
    s.push(
      '  4. Send the supplier reviewUrl: they fix unmatched lines and press "Naskladnit" (Stock).'
    )
    s.push('  5. From chat: get_stock_draft(draftId) shows the lines; update_stock_draft(draftId,')
    s.push('     lines:[{index, productId?, amount?, price?, …}]) fixes single lines (items:[…]')
    s.push('     would replace ALL of them); discard_stock_draft(draftId) throws it away;')
    s.push('     commit_stock_draft(draftId, confirmWarnings?) stocks it — only after the user saw')
    s.push('     the lines and said so. list_stock_drafts() shows the open one (if any).')
    s.push(
      '     Never rewrite the whole draft (items) to add a receipt — lines of others would go.'
    )
    s.push('  6. A whole receipt stocked twice: list_stock_drafts(status:"committed") → canVoid →')
    s.push(
      '     void_stock_draft(draftId, reason) after the user agreed. Sold from → correct_delivery.'
    )
    s.push('  ↳ Multipacks: divide the pack price by its pieces (6× for 89.90 → 14.98 per piece).')
    s.push(
      '  Errors: DRAFT_NOT_FOUND, DRAFT_CLOSED, DRAFT_EMPTY, DRAFT_HAS_SALES, DRAFT_VOIDED, DRAFT_TRANSFERRED,'
    )
    s.push('  DRAFT_NOT_COMMITTED, DRAFT_INCOMPLETE (a line has no')
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
    s.push('  ↳ scope "all" shows colleagues\' lots with purchasePrice null — that is private.')
    s.push('  list_stock_adjustments(origin?:"write_off"|"inventory", reason?, productId?, scope?)')
    s.push('  → past write-offs and count differences with countId (for classify_inventory_loss)')
    s.push('')
    s.push('### Stock out: losses, counts, fixing lots')
    s.push(
      '  write_off_stock(productId, quantity, reason:"expired"|"damaged"|"stolen"|"other", note?)'
    )
    s.push("  ↳ known losses; off the oldest lots first (FIFO) — anyone's lots, so a write-off may")
    s.push("    land on a colleague's lot (lots[].supplier). Errors: NOT_ENOUGH_STOCK.")
    s.push('  record_inventory_count(note?, items:[{productId, counted}])')
    s.push('  ↳ counted only: the server compares with the current stock of ALL lots. Shortfall is')
    s.push(
      '    written off without a reason; classify_inventory_loss(countId, productId, reason) adds one.'
    )
    s.push('  void_delivery(deliveryId, reason)  ← a lot nothing sold from (duplicate add_stock)')
    s.push(
      '  correct_delivery(deliveryId, amount?, price?, purchasePrice?, reason)  ← pass only what'
    )
    s.push(
      '    changes; pieces down, prices changed; uninvoiced purchases from the lot are repriced.'
    )
    s.push('  void_delivery / correct_delivery: only your own lots (admins: any).')
    s.push(
      '  reprice_stock(productId, price)  ← sale or price rise of all YOUR pieces left; sold pieces'
    )
    s.push(
      '    and invoices never change, no buyer is e-mailed. A typo on one lot → correct_delivery.'
    )
    s.push(
      '  reprice_stock(productId, lots: [{deliveryId, price}])  ← exact lots (list_stock_lots);'
    )
    s.push("    admins may pass a colleague's lot — its owner is e-mailed.")
    s.push(
      '  revert_write_off(adjustmentId)  ← a manual write-off within 7 days (revertible: true).'
    )
    s.push('  Errors: NOTHING_IN_STOCK, NO_CHANGE, ADJUSTMENT_NOT_FOUND, NOT_A_WRITE_OFF,')
    s.push('  ALREADY_REVERTED, REVERT_TOO_LATE.')
    s.push('  Errors: DELIVERY_NOT_FOUND, DELIVERY_VOIDED, DELIVERY_HAS_ORDERS (sold from),')
    s.push(
      '  DELIVERY_HAS_ADJUSTMENTS (written off / counted — correct instead), DELIVERY_TRANSFERRED'
    )
    s.push('  (handed over between suppliers — write off or correct instead), AMOUNT_BELOW_SOLD,')
    s.push('  AMOUNT_INCREASE_NOT_ALLOWED (extra pieces = new lot via add_stock), NO_CHANGE.')
    s.push('')
    s.push('### Shopping list (what to buy FOR THE FRIDGE, how much, for how much)')
    s.push('  get_shopping_list(horizonDays?, scope?:"mine"|"all", categoryIds?)')
    s.push(
      '  → {settings, totals, lines:[{key, kind, name, quantity, stock, daysOfCover, unitCost,'
    )
    s.push('     goodPrice, hints[]}], enoughStock[]}')
    s.push('  ↳ kind "group" = a purchase group: any product of it will do; hints = best sellers.')
    s.push('    horizonDays/scope/categoryIds only change this answer; they are not saved.')
    s.push('    Edits ARE saved: update_shopping_list_line(key, quantity?, unitCost?, isChecked?,')
    s.push('    isRemoved?, note?) · add_shopping_list_line(productId?|label, quantity, …)')
    s.push(
      '  complete_shopping_list() ← back from shopping: the ticked lines (or all) are added to'
    )
    s.push(
      '    the open draft and the list closes; then update_stock_draft(lines) from the receipt.'
    )
    s.push('  list_product_groups() / create_product_group(name, categoryId, note?, productIds?)')
    s.push('  ↳ an existing group of that name is reused and the products are added to it.')
    s.push('  Errors: LINE_NOT_FOUND, GROUP_NAME_TAKEN, GROUP_NOT_FOUND.')
    s.push('')
    s.push('### Earnings')
    s.push('  get_finance_summary(year?, byProduct?, sortBy?, page?) → revenue, costOfSales,')
    s.push('  grossProfit, ownConsumption,')
    s.push('  shrinkage {lostUnits, surplusUnits, lossCost, lossValue, lossRate, byReason[]},')
    s.push('  netProfit, achievedMarginPercent, breakEvenMarginPercent, incomeLimit')
    s.push('  ↳ Only sales to OTHER people count. What the supplier bought from their own lots is')
    s.push('    ownConsumption {units, value}: not revenue, not profit, not in the yearly limit.')
    s.push('  ↳ lossCost = shrinkage at purchase prices (selling where none); lossValue = at')
    s.push('    selling prices. netProfit subtracts only shrinkage of lots with a purchase price,')
    s.push('    null while no sale has one. Past the limit there is only a warning.')
    s.push('  ↳ incomeLimit counts by PAYMENT date: amount = received, pending = still owed.')
    s.push('    money = {purchased, stockAtCost, stockUnitsWithoutCost, uninvoiced, unpaid}.')
    s.push('')
    s.push('### Invoicing flow (monthly billing run)')
    s.push('  1. uninvoiced_summary() → {buyers:[{buyerId, buyerName, orderCount, totalCost,')
    s.push('     isSelf?}], totalUninvoiced, ownConsumption}')
    s.push('     Show it and confirm with the user — step 2 e-mails people and cannot be undone.')
    s.push(
      '  2. generate_invoices(buyerId?, expectedTotal) → one invoice per buyer (or one buyer);'
    )
    s.push("     expectedTotal = the confirmed totalUninvoiced (or that buyer's totalCost).")
    s.push('  3. list_issued_invoices(status?:"awaiting") → payments waiting for confirmation')
    s.push('  4. approve_payment(invoiceId) or reject_payment(invoiceId) — the buyer is e-mailed')
    s.push('  Errors: TOTAL_CHANGED (preview again), ALREADY_PAID, PAYMENT_ALREADY_CONFIRMED')
    s.push('  (undo only on the web), NOTHING_TO_REJECT, FORBIDDEN.')
    s.push('')
  }

  if (isAdmin) {
    s.push('## ADMIN (you have admin access)')
    s.push('')
    s.push('  dashboard_stats() → global overview.')
    s.push('  list_users(role?, disabled?, page?, perPage?)')
    s.push('  update_user(userId, role?, isDisabled?, keypadId?)')
    s.push(
      '  Errors: LAST_ACTIVE_ADMIN_REQUIRED, USER_HAS_UNINVOICED_ORDERS, KEYPAD_ID_TAKEN, KEYPAD_ID_RESERVED,'
    )
    s.push(
      '  SUPPLIER_HAS_OPEN_BUSINESS (a supplier with stock or uninvoiced sales cannot be disabled'
    )
    s.push(
      '  or made a customer — hand the stock over on the web, invoice the sales; unpaid invoices'
    )
    s.push(
      '  do not block). approve_payment / reject_payment also work for invoices of a supplier who'
    )
    s.push(
      '  left (disabled or a customer now); an active issuer settles their own (ISSUER_ACTIVE).'
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
  s.push('  - A result\'s "hint" says what it means and what to do next; "note" is always data')
  s.push("    (a draft's note, a line's note).")
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
