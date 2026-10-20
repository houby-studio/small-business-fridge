# MCP (Model Context Protocol) Server

Fridgora exposes an MCP server at `/mcp`, allowing AI assistants like Claude Desktop, Claude Code or GitHub Copilot to interact with the fridge programmatically — browse the shop, buy products, manage invoices and payments, stock products, run the fridge's stock (write-offs, counts, corrections), plan shopping and administer users.

## Authentication

Three authentication paths are supported:

### 1. Entra ID OAuth (for Microsoft-linked accounts)

The MCP endpoint implements [OAuth 2.0 Protected Resource Metadata (RFC 9728)](https://datatracker.ietf.org/doc/html/rfc9728). AI tools that support MCP OAuth will:

1. Hit `/mcp` without auth and receive a `401` with a `WWW-Authenticate` header.
2. Follow the `resource_metadata` URL to `/.well-known/oauth-protected-resource`.
3. Discover the authorization server and complete a PKCE flow.
4. Present the resulting access token as a Bearer token to the MCP endpoint.

Microsoft Entra ID JWTs are verified against Entra's JWKS endpoint and resolved to a local user via their linked Microsoft account (`user_auth_identities`).

**Requirements:**

- The user must have linked their Microsoft account in the app (Profile → Security → Link Microsoft account).
- `AUTH_PROVIDER_MICROSOFT_CLIENT_ID` and `AUTH_PROVIDER_MICROSOFT_TENANT_ID` must be configured.

### 2. Built-in OAuth server (works with Claude Web via Dynamic Client Registration)

The app also runs its own minimal OAuth 2.1 authorization server:

- `GET /.well-known/oauth-authorization-server` — RFC 8414 metadata
- `POST /oauth/register` — RFC 7591 Dynamic Client Registration (public clients, PKCE only)
- `GET /oauth/authorize` — authorization endpoint (uses the normal web login)
- `POST /oauth/token` — token endpoint (issues opaque tokens via the personal API token mechanism)

**No configuration needed in the MCP client** — just point it at the URL:

```json
{
  "mcpServers": {
    "fridge": {
      "url": "https://your-app.example.com/mcp"
    }
  }
}
```

### 3. Personal API token (for automated scripts)

1. Log in to the web app.
2. Go to **Profile → API Tokens** and create a token (shown only once).

```json
{
  "mcpServers": {
    "fridge": {
      "url": "https://your-app.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <your-personal-api-token>"
      }
    }
  }
}
```

> Kiosk accounts and disabled accounts are rejected at `/mcp` with `403`. So is an account with an unverified e-mail while the instance requires verification (`AUTH_EMAIL_VERIFICATION_REQUIRED`) — the same gate the web app has; the user verifies the e-mail on the web (Profile) and the assistant works again.

## Transport

Uses the **MCP Streamable HTTP** transport (stateless mode). Each request is authenticated independently — no persistent session is maintained. The SDK answers with SSE or plain JSON based on the client's `Accept` header.

## Workflow Prompt

The server exposes a built-in prompt that gives AI agents a complete, role-aware workflow reference — exact tool sequences, parameter names, error codes, a decision table ("which tool when") and a Czech glossary (_naskladnit_, _odepsat_, _inventura_, …).

```
prompts/list  → ["workflow"]
prompts/get   → { name: "workflow" }
```

**The tool descriptions stand on their own.** Every description says in its first sentence when to use the tool and in its last when to use another one instead, so an assistant works correctly without the prompt. The prompt is the long form — load it when a session will do many supplier operations or when you write your own system prompt (e.g. for Copilot Studio) and want something to copy from.

MCP clients do not load prompts by themselves; the user picks it:

- **Claude Desktop** — the **+** button in the chat box → the _fridge_ connector → **workflow**.
- **claude.ai** — open the connector's menu in the chat box and choose the **workflow** prompt.
- **Claude Code / scripts** — `prompts/get { name: "workflow" }` and send the text as the first user message.

## Choosing the right tool

Several tools answer similar-sounding questions. The descriptions encode these rules; this is the human-readable copy.

1. **`add_stock` vs `create_stock_draft`.** `add_stock` only when the user themselves states the product, the pieces and a price and wants it now ("naskladni 24 kofol po 18"). Anything the assistant _inferred_ — a receipt, a photo, "I bought…", more than one product, an uncertain match or a missing price — goes into `create_stock_draft` for the supplier to review. `add_stock` stocks immediately; a draft stocks nothing.
2. **One open draft per supplier.** The web's "Naskladnit", a finished shopping list (`complete_shopping_list`) and `create_stock_draft` all add lines to the supplier's single open draft (it is created when there is none). Every line carries its `source` (`web`, `shopping_list`, `assistant`). To add a receipt, call `create_stock_draft` again — never rewrite the draft with `update_stock_draft(items)`, which would drop the others' lines.
3. **Never `create_product` from receipt text.** Search the catalog first (`list_catalog_products`, by barcode, then by one distinctive word); create a product only when nothing matched **and** the user confirmed it is new. Otherwise leave the draft line without a `productId` — the supplier picks it on the web.
4. **Four "what is there" tools.** `get_stock` = what is in the fridge, running out or selling (per product, with insights). `recent_deliveries` = individual lots (which lot, when, how much is left — the `deliveryId` for `void_delivery` / `correct_delivery`). `list_products` = what a buyer can buy right now and for how much. `list_catalog_products` = does the product exist, what is its id.
5. **`get_shopping_list` vs `get_recommendations`.** A supplier asking what to buy _for the fridge_ wants `get_shopping_list`. `get_recommendations` is what the user tends to buy _for themselves_ — a snack, not a shopping trip.
6. **Preview before invoicing.** `generate_invoices` e-mails people and cannot be undone: call `uninvoiced_summary` first, confirm the buyers and the total with the user and pass that total as `expectedTotal` — if someone bought something in between, nothing is issued (`TOTAL_CHANGED`). Admins invoicing one buyer across _all_ suppliers use `generate_invoices_for_user`; `generate_invoices(buyerId)` covers only your own sales.
7. **Known loss vs unexplained difference.** "I threw away 3 expired bars" is `write_off_stock` (pieces and reason known). "I counted the shelf: 5 Kofola, 2 Pepsi" is `record_inventory_count` with the counted pieces only — the server compares them with the current stock of **every** supplier's lots (the shelf holds them all), so `get_stock(scope: "mine")` never feeds a count. The shortfall gets a reason later with `classify_inventory_loss`; `list_stock_adjustments` finds the `countId` of an older count. Write-offs and counts take the oldest lots first, whoever stocked them. A duplicate `add_stock` is undone with `void_delivery` while nothing sold from the lot; afterwards `correct_delivery` (pass only what changes) lowers the pieces.
8. **E-mails.** Every channel sends the same e-mails, because the services send them: issued invoices (with the QR payment), payment reported / withdrawn, payment confirmed / rejected, storno, repriced purchases and lots changed by someone else. A self-invoice (the supplier's own purchases) is issued as paid and e-mails nobody.

### Units and vocabulary

- `price` — selling price per piece, whole CZK. `purchasePrice` / `unitCost` — what was paid per piece, CZK with two decimals (divide a multipack by its pieces).
- `amount` — pieces in a delivery lot. `quantity` — pieces in a purchase, a write-off or a shopping-list line.
- `scope` — `"all"` = the whole fridge (_Celá lednice_), `"mine"` = only my lots (_Jen moje_). Default `"all"` for `get_stock`, `"mine"` for `get_shopping_list` and `recent_deliveries`.
- `lossRate` is a fraction 0–1; every `*Percent` field is a percentage. Times are ISO 8601 with offset (Europe/Prague).
- _Příjemka_ = stocking draft (`*_stock_draft`). _Naskladnit_ (Stock) is the web button that commits one. _Odpis_ = write-off, _manko_ = shrinkage, _inventura_ = inventory count.

## Available Tools

Tools are granted based on the account role. Admins implicitly get supplier tools. Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: false`, a human `title`) so a client can ask the user before an irreversible call; the **Kind** column below mirrors them.

### All Users (customer, supplier, admin)

| Tool                     | Kind        | Description                                                                 |
| ------------------------ | ----------- | --------------------------------------------------------------------------- |
| `list_products`          | read        | What a buyer can buy now, with stock and FIFO price (respects allergens)    |
| `list_categories`        | read        | Categories and their ids                                                    |
| `buy_product`            | destructive | 1-click purchase by deliveryId or productId (quantity 1–10)                 |
| `get_my_orders`          | read        | Your own purchases with invoiced status                                     |
| `get_my_invoices`        | read        | Invoices you received as a buyer (unpaid / awaiting / paid)                 |
| `get_payment_qr`         | read        | Czech SPD QR payment string + bank details for an invoice you received      |
| `request_payment`        | idempotent  | Report an invoice you received as paid; e-mails the supplier                |
| `cancel_payment_request` | idempotent  | Withdraw a reported payment; e-mails the supplier                           |
| `get_recommendations`    | read        | What this user tends to buy for themselves (not for restocking the fridge)  |

### Supplier (and admin)

**Catalog**

| Tool                    | Kind       | Description                                                                 |
| ----------------------- | ---------- | --------------------------------------------------------------------------- |
| `list_catalog_products` | read       | Find a productId by name or barcode, incl. out-of-stock; shows `groupId`; archived only with `includeArchived` |
| `create_product`        | idempotent | New catalog product (idempotent by name or barcode, image added later on the web); allergens by name |
| `update_product`        | idempotent | Change name, description, category, barcode, allergens (names), group; returns `changes` |

**Stock in**

| Tool                   | Kind        | Description                                                                 |
| ---------------------- | ----------- | --------------------------------------------------------------------------- |
| `add_stock`            | destructive | Stock ONE product now — the user stated product, pieces and price; warns about a duplicate lot or an unusual price until `confirmWarnings: true` |
| `create_stock_draft`   | additive    | Bulk stocking to review on the web — receipts, photos, several products; adds the lines to the supplier's one open draft (`added`, `created`) |
| `list_stock_drafts`    | read        | Your open draft (at most one), or with `status: "committed"` those stocked in the last 30 days (`canVoid`) |
| `void_stock_draft`     | destructive | Take back a whole stocked draft while nothing of it sold or was written off |
| `get_stock_draft`      | read        | Lines of one draft and what blocks stocking it (`problems`); a group line lists `groupProducts` to pick from |
| `update_stock_draft`   | idempotent  | Fix single lines by index (`lines`), or replace all of them (`items`)       |
| `discard_stock_draft`  | destructive | Throw an open draft away; nothing in the stock changes                      |
| `commit_stock_draft`   | destructive | Stock every line of a draft — only after the user saw the lines and said so; same warnings as `add_stock` |

**Watching the stock**

| Tool                | Kind | Description                                                                         |
| ------------------- | ---- | ----------------------------------------------------------------------------------- |
| `get_stock`         | read | Stock per product, whole fridge or mine; `stockState` low/out; low-stock list, top movers |
| `recent_deliveries` | read | Individual lots, newest first, with `purchasePrice` (yours only — a colleague's is private, admins see all), `amountLost`, corrections; voided lots only with `includeVoided` |
| `list_stock_adjustments` | read | Past write-offs and count differences with reason, `countId`, `revertedAt`, `revertible` |
| `list_stock_lots`   | read | Lots of one product with pieces left, in FIFO order (they sell and are written off oldest first): supplier, pieces, selling price, `mine`, `editable`; no purchase prices |

**Stock out: losses, counts, fixing lots**

| Tool                      | Kind        | Description                                                                 |
| ------------------------- | ----------- | --------------------------------------------------------------------------- |
| `write_off_stock`         | destructive | Known losses (expired, damaged, stolen, other) — off the oldest lots first, anyone's |
| `record_inventory_count`  | destructive | A shelf count — counted pieces only; the server compares with the current stock of all lots |
| `classify_inventory_loss` | idempotent  | Give a count's shortfall of one product a reason                            |
| `void_delivery`           | destructive | Cancel your lot nothing sold from (a duplicate `add_stock`)                 |
| `reprice_stock`           | destructive | Sale or price rise of the pieces still in stock: `price` = all **your** lots of the product (admins too), `lots: [{deliveryId, price}]` = exact lots (admins: anyone's, the owner is e-mailed); sold pieces never change. Returns the change per lot |
| `revert_write_off`        | destructive | Take back a manual write-off within 7 days (author or admin)                |
| `correct_delivery`        | destructive | Lower your lot's pieces, change its selling or purchase price (only what changes); reprices uninvoiced purchases |

**Planning**

| Tool                        | Kind       | Description                                                                 |
| --------------------------- | ---------- | --------------------------------------------------------------------------- |
| `get_shopping_list`         | read       | What to buy for the FRIDGE, how much, for how much ([details](shopping-list.md)) |
| `update_shopping_list_line` | idempotent | Change a saved line: pieces, expected price, tick, hide, note               |
| `add_shopping_list_line`    | additive   | Put a product or free text on the list                                      |
| `complete_shopping_list`    | additive   | Back from shopping: ticked lines (or all) are added to the open stocking draft, the list closes |
| `list_product_groups`       | read       | Purchase groups — interchangeable products planned as one line              |
| `create_product_group`      | idempotent | New group, or add the given products to the existing group of that name     |

**Money**

| Tool                   | Kind        | Description                                                                 |
| ---------------------- | ----------- | --------------------------------------------------------------------------- |
| `uninvoiced_summary`   | read        | Who owes how much, grouped by buyer — the preview before invoicing; own purchases flagged `isSelf` |
| `generate_invoices`    | destructive | Issue invoices (all buyers or one); `expectedTotal` guards the preview; e-mails the buyers |
| `list_issued_invoices` | read        | Invoices you issued, filterable by status                                   |
| `approve_payment`      | destructive | Confirm a received payment (idempotent: `ALREADY_PAID`); e-mails the buyer; admins also for a supplier who left |
| `reject_payment`       | destructive | Reject a reported payment (only "awaiting"); e-mails the buyer              |
| `get_finance_summary`  | read        | Sales to others, own consumption, profit, shrinkage by reason, `money`, yearly limit by payment date (`amount` received, `pending` owed); `byProduct` adds the breakdown |

### Admin Only

| Tool                         | Kind        | Description                                                             |
| ---------------------------- | ----------- | ----------------------------------------------------------------------- |
| `dashboard_stats`            | read        | Global overview stats                                                   |
| `list_users`                 | read        | Browse users with role/status filters                                   |
| `update_user`                | idempotent  | Change role, enable/disable, keypad ID; a supplier with stock or uninvoiced sales cannot be switched off (`SUPPLIER_HAS_OPEN_BUSINESS`) |
| `list_all_orders`            | read        | All orders with filters                                                 |
| `list_all_invoices`          | read        | All invoices with filters                                               |
| `storno_order`               | destructive | Cancel an uninvoiced order (restores stock); e-mails buyer and supplier |
| `generate_invoices_for_user` | destructive | Invoice all debts of one buyer across suppliers; e-mails the buyer      |
| `create_category`            | idempotent  | Create a product category                                               |
| `get_audit_logs`             | read        | Query the system audit log                                              |

## Usage Examples

### Customer: buy a drink

```
User: Kup mi kofolu
Claude: [calls list_products] → finds Kofola with deliveryId=3, price 25 CZK
        [calls buy_product with deliveryId=3]
        → "Koupeno! Kofola za 25 Kč. Zaplatíš později přes fakturu."
```

### Customer: pay an invoice

```
User: Kolik dlužím a jak to zaplatím?
Claude: [calls get_my_invoices with status="unpaid"]
        [calls get_payment_qr with invoiceId=12]
        → "Dlužíš 260 Kč dodavateli Jakub. IBAN CZ65..., SPD kód pro QR platbu: ..."
        [after user pays] → [calls request_payment with invoiceId=12]
```

### Supplier: monthly billing run

```
User: Vyfakturuj všechny nezaplacené nákupy
Claude: [calls uninvoiced_summary] → 4 buyers owe 1 240 CZK total
        → "Vyfakturuju Petrovi 420 Kč, Janě 380 Kč, … celkem 1 240 Kč. Mám?"
User: Ano
Claude: [calls generate_invoices with expectedTotal=1240]
        → "Vygenerovány 4 faktury. Kupující dostali e-mail s QR platbou."
```

### Supplier: plan a shopping trip

```
User: Jdu zítra do Lidlu, co mám koupit?
Claude: [calls get_shopping_list] → 6 lines, 84 pcs, about 1 380 CZK
        → "Energy drink s cukrem 24 ks (nejvíc jde Monster Mango), Pepsi plech 24 ks
           po ~14,90 Kč, Tyčinky 20 ks … Twix je výhodný do 13,90 Kč."
User: Pepsi koupím jen 12.
Claude: [calls update_shopping_list_line with key="g-3", quantity=12]
        → "Upraveno, na webu to uvidíš taky."
```

### Supplier: stock a whole receipt

```
User: [photo of a receipt] Naskladni tohle.
Claude: [reads the receipt, calls list_catalog_products to match the lines]
        [calls create_stock_draft with 5 lines, one without a sure match]
        → "Připravil jsem příjemku (5 řádků, 1 bez produktu). Zkontroluj ji
           a naskladni: https://…/supplier/stock/drafts/12"
```

Nothing is stocked until the supplier reviews the draft — on the web, or in chat as below. See
[docs/shopping-list.md](shopping-list.md#receipts-via-an-ai-assistant).

### Supplier: fix a draft line from chat

```
User: V příjemce 12 je ta třetí položka Monster Mango, produkt 44. Oprav to.
Claude: [calls get_stock_draft with draftId=12] → 5 lines, line index 2 has no productId
        [calls update_stock_draft with draftId=12, lines=[{index: 2, productId: 44}]]
        → "Opraveno. Všechny řádky jsou kompletní — můžeš naskladnit na webu,
           nebo řekni a naskladním to odsud."
User: Naskladni.
Claude: [calls commit_stock_draft with draftId=12]
        → "Naskladněno, 5 dodávek. Lidi si můžou kupovat."
```

A duplicate lot or an unusual price makes `commit_stock_draft` (and `add_stock`) answer with `stocked: false` and `warnings` instead of stocking. The assistant shows them and repeats with `confirmWarnings: true` only if the user confirms.

### Supplier: write off expired snacks

```
User: Vyhodil jsem 3 prošlé tyčinky.
Claude: [calls list_catalog_products with search="tyčinka"] → productId 10
        [calls write_off_stock with productId=10, quantity=3, reason="expired"]
        → "Odepsáno 3 ks z nejstarší dodávky. V hospodaření to uvidíš jako manko."
```

### Admin: check who changed a user account

```
User: Kdo naposledy měnil účet Jakuba?
Claude: [calls list_users to find the user ID]
        [calls get_audit_logs with userId=..., action="user.updated"]
        → "Admin Pavel změnil roli na supplier 2026-07-01 ve 14:23."
```

## Tool-call Logging

Every tool call is recorded in the `mcp_tool_calls` table (user, tool, arguments, success, duration) for auditing and debugging. A call that returned a tool error (`isError`) counts as `success = false` and keeps the first 500 characters of the message — with its error code — in `error_message`, so the table shows where agents get stuck.

## Error Handling

All tools return structured responses. A successful result may carry `hint` — what it means and what to do next, for the assistant; `note` is always data (the note of a draft, a list line or a write-off). When an operation fails, the tool returns `isError: true` with a message of the form `<what failed> (error code: CODE). <what to do next>`. Raw database errors never reach the agent — they are logged and reported as `INTERNAL`.

| Code                                                                 | Meaning                                                                                      |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `OUT_OF_STOCK`                                                       | the product / lot has no stock left                                                          |
| `PRICE_CHANGED`                                                      | the lot sold next (FIFO) costs something other than expected; list again and confirm         |
| `FORBIDDEN`                                                          | the record belongs to someone else                                                           |
| `NOT_FOUND`, `PRODUCT_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `GROUP_NOT_FOUND`, `DELIVERY_NOT_FOUND`, `DRAFT_NOT_FOUND`, `LINE_NOT_FOUND` | no record with that id — resolve ids with a `list_*` / `get_*` tool, never guess |
| `VALIDATION`                                                         | the arguments contradict the description (e.g. a draft line with neither product nor label)  |
| `PRICE_REQUIRED`                                                     | `add_stock` needs a selling price, a purchase price, or both                                 |
| `NEEDS_CONFIRMATION`                                                 | a draft commit has warnings; shown as `stocked: false` + `warnings`, repeat with `confirmWarnings` |
| `DRAFT_HAS_SALES`, `DRAFT_VOIDED`, `DRAFT_NOT_COMMITTED`, `DRAFT_TRANSFERRED` | `void_stock_draft`: something sold or was written off; already voided; not stocked yet; its stock was handed over |
| `DRAFT_CLOSED`, `DRAFT_EMPTY`, `DRAFT_INCOMPLETE`                    | the draft was already stocked/discarded, has no lines, or a line lacks a product or a price |
| `DELIVERY_VOIDED`, `DELIVERY_HAS_ORDERS`, `DELIVERY_HAS_ADJUSTMENTS`, `DELIVERY_TRANSFERRED` | the lot is already voided; something sold from it or was written off / counted, or it was handed over between suppliers (use `correct_delivery` or a write-off) |
| `AMOUNT_BELOW_SOLD`, `AMOUNT_INCREASE_NOT_ALLOWED`, `NO_CHANGE`      | correction limits: not below what sold; extra pieces are a new lot; nothing differs          |
| `NOTHING_IN_STOCK`, `ADJUSTMENT_NOT_FOUND`, `NOT_A_WRITE_OFF`, `ALREADY_REVERTED`, `REVERT_TOO_LATE` | `reprice_stock` has nothing of yours to reprice (or a lot in `lots` is sold out); `INVALID_PRICE`, `DUPLICATE_LOT` are bad `lots`; `revert_write_off` limits (manual write-offs, 7 days, author or admin) |
| `NOT_ENOUGH_STOCK`, `NOTHING_COUNTED`, `NOTHING_TO_CLASSIFY`         | inventory: fewer pieces in stock than written off; no items; no shortfall to explain         |
| `GROUP_NAME_TAKEN`, `LIST_EMPTY`                                     | a purchase group of that name exists; the shopping list has nothing to buy                   |
| `ALREADY_PAID`, `ORDER_ALREADY_INVOICED`                             | invoice already paid; storno is not possible after invoicing                                 |
| `PAYMENT_ALREADY_CONFIRMED`, `NOTHING_TO_REJECT`                     | `reject_payment` on a paid invoice (undo only on the web) or one with no reported payment    |
| `ISSUER_ACTIVE`, `SUPPLIER_HAS_OPEN_BUSINESS`                        | an admin settles payments only for a supplier who left; a supplier with stock or uninvoiced sales cannot be switched off |
| `TOTAL_CHANGED`                                                      | purchases changed since `uninvoiced_summary`; nothing was issued — preview and confirm again |
| `BARCODE_TAKEN`, `ALLERGEN_NOT_FOUND`                                | another product has the barcode; an allergen name is unknown (the message lists valid ones)  |
| `LAST_ACTIVE_ADMIN_REQUIRED`, `USER_HAS_UNINVOICED_ORDERS`, `KEYPAD_ID_TAKEN`, `KEYPAD_ID_RESERVED` | user-management constraints                                         |
| `INTERNAL`                                                           | unexpected server error — retry once, then contact the admin                                 |

## Evaluating tool selection

`app/mcp/eval_scenarios.ts` holds short user messages (Czech and English) with the tool an assistant should pick first, and `node ace mcp:eval` runs them against an Azure OpenAI deployment:

```bash
export AZURE_OPENAI_ENDPOINT=https://my-resource.openai.azure.com/
export AZURE_OPENAI_API_KEY=…
node ace mcp:eval --model=gpt-4o                      # tool descriptions alone
node ace mcp:eval --model=gpt-4o --system=workflow    # with the workflow prompt as system message
node ace mcp:eval --model=gpt-4o --scenarios=add-stock,receipt-to-draft
```

- The tool definitions come from the **live MCP server** (an in-memory transport and `tools/list`), per role — a scenario for a supplier is judged with exactly the tools a supplier sees, so a description change is measured as soon as it is made and nothing can drift. A functional test checks that every scenario names tools its role really gets.
- Run both modes: the first number is the quality of the descriptions (what every client gets), the second the quality of the whole package.
- Environment variables: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT` (or `--model`), `AZURE_OPENAI_API_VERSION` (default `2024-12-01-preview`). They are listed, commented out, in `.env.example`; the running app never reads them. Without them the command explains what is missing and exits with code 1.
- A scenario judges the **first** call. `allowNoTool` scenarios are sent with `tool_choice: "auto"`: answering in words (asking the user) passes, the forbidden action fails — e.g. `commit-without-review` must not commit a draft the user has not seen. `history` adds earlier turns, including tool results, so `warnings-need-consent` checks that an assistant does not repeat `add_stock` with `confirmWarnings: true` after a vague "ok".
- A unit test (`tests/unit/mcp/eval_coverage.spec.ts`) requires every tool an admin sees to be the expected tool of at least one scenario.
- Results land in `mcp_eval_runs` / `mcp_eval_results` (one row per scenario with the tool and arguments the model chose), labelled with the model and whether the prompt was on.

**Adding a scenario from real feedback.** When an assistant misbehaves on a real message: copy the message verbatim, decide which tool should have been called (and which alternatives are acceptable as a first step), add it to `eval_scenarios.ts` with `role` and `source: 'user_feedback'`, and re-run. If it passes, it is a regression guard. If it fails without the prompt, fix the tool descriptions; if it fails with the prompt too, fix `prompts.ts` as well.
