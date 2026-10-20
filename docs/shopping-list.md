# Shopping list, stocking drafts, purchase prices and shrinkage

Everything a supplier needs between two shopping trips: what to buy, how much and for how much;
stocking a whole receipt at once; and knowing what the fridge really earns once missing pieces
are counted. All of it works from the fridge's own data — no external price feed is needed.

## Where things live

The supplier menu has seven entries. Two of them are the home of this feature, the rest gained
tabs or settings.

| Menu entry      | URL                        | What it is for                                                                       |
| --------------- | -------------------------- | ------------------------------------------------------------------------------------ |
| Stock           | `/supplier/stock`          | Tabs **Stock** (one table with filters, row actions _Stock_, _Change price_ and _Write off_; _Stock_ opens the one open draft, a chip beside it says when one has lines), **History** (deliveries, write-offs and inventory differences, or stocked drafts by number) and **Inventory count**; the menu badge shows an open draft with lines |
| Shopping list   | `/supplier/shopping-list`  | What to buy, how much and at what price                                              |
| Products        | `/supplier/products`       | Tabs **Products** and **Groups** (purchase groups)                                   |
| Earnings        | `/supplier/finance`        | Sales, purchase cost, shrinkage, margin (settings dialog), yearly limit              |

Vocabulary used everywhere (UI, MCP, audit): a **delivery** is one stocked lot; **to stock** is
the action; a **stocking draft** (_příjemka_) is a bulk delivery being prepared; **scope** is
_whole fridge_ or _mine only_ (`all` / `mine`); a **write-off** records pieces you know about,
**shrinkage** is the net result, a **surplus** is what an inventory count found extra; prices are
always the **purchase price** (what the supplier paid, two decimals) and the **selling price**
(what customers pay, whole crowns).

## Stocking drafts (příjemky)

A draft is a list of lines — product, pieces, purchase price, selling price — waiting to be
stocked (`stock_drafts`, `stock_draft_items`). Nothing is on the shelf until the supplier presses
**Stock**, which creates one delivery per line in a single transaction. The draft page is the only
stocking form:

- One draft, really: a supplier has at most one open draft (a partial unique index on
  `stock_drafts(supplier_id) WHERE status = 'open'` and an advisory lock keep it so). **Stock**
  on the stock page, the row action on a product, saving a new product, a finished shopping list
  and an AI assistant all add lines to it, or start it when there is none
  (`StockDraftService.appendLines`; the web uses `POST /supplier/stock/drafts` with an optional
  `productId`). Each line remembers who added it (`stock_draft_items.source`: `web`,
  `shopping_list`, `assistant`) and shows a badge _ze seznamu_ / _od AI_; hand-made lines carry
  none. A draft started more than a day ago carries an amber _Rozpracováno {date}_ badge. The
  web row action does not add a product twice — its line is focused instead; the list and the
  assistant always append (two receipt lines may carry two prices), and the commit still warns
  about a double. There is no list of drafts: `/supplier/stock/drafts` leads to the open draft
  or to the stock page.
- A purchase price is prefilled only from the supplier's **own** last lot — what a colleague
  paid is theirs to know. The selling price comes from the product's last lot, whoever stocked it.
- The page always ends with an empty line. Picking a product fills the last purchase and selling
  prices in as values; Enter moves through amount, purchase price and selling price, and Enter on
  the selling price confirms the line and opens the next one. Ctrl+Enter stocks the draft. One
  item is stocked in three interactions: type the product and press Enter, type the amount and
  press Enter, press **Stock**.
- An empty selling price is a suggestion the line shows in grey: the purchase price plus the
  margin of the draft's **owner** (rounded up to whole crowns), never below the product's last
  selling price — `suggestDraftPrice` in `app/services/shopping/pricing.ts`, used by the commit,
  its warnings and MCP alike, and mirrored for the page in `inertia/composables/pricing_rules.ts`
  (a unit test keeps the two equal). Enter, Tab or stocking accepts it.
- Every change saves itself after a short pause (the footer says _Uloženo_ / _Ukládám…_); leaving
  the page waits for a pending save, so nothing is lost without a Save button. A failed save says
  _Uložení selhalo_ and leaving then asks first; the browser's Back button sends the last change
  on its way as the page goes. Each save carries the draft's version (`updated_at`): a save over
  a newer draft — the assistant fixed a line, another tab — is refused, and the page loads the
  newer draft and says so instead of overwriting it. MCP sends no version (last write wins).
- Stocking runs in one transaction under the draft's lock, so a save racing it waits and finds
  the draft closed — what is stocked is exactly what was checked. Favourite-product e-mails go
  out only for products that had run out, one e-mail per person for the whole draft.
- Lines from the shopping list carry an **estimated** purchase price (amber _odhad_); typing the
  receipt price clears it. Stocking with an estimate left asks once more.
- _Nový produkt_ on a line without a product saves the draft, opens the product form with the
  line's text and group prefilled, and saving the product returns to that very line.
- Before stocking, every line is checked for a **duplicate** (the same supplier stocked the same
  product within 30 minutes), an **unusual price** (1.5× away from the last delivery) and an
  **unusual purchase price** (1.5× away from the supplier's own last one — a pack price typed in
  for a piece). The
  draft page shows them in one dialog with _Stock anyway_; MCP returns them and asks for
  `confirmWarnings`.
- Empty drafts are not counted anywhere; the menu badge and the chip on the stock page count
  open drafts with at least one line. An empty draft untouched for a week is discarded at night.

Lines come from three places: by hand (above), from the shopping list (**Finish shopping**) and
from an AI assistant over MCP, typically a receipt photo (below). Each line shows its source.
Stocked drafts are listed in **Sklad › Historie › Příjemky** by number (whole fridge or own;
a colleague's purchase total stays hidden), where each opens read-only and, while nothing of it
was sold, written off or handed over, can be voided as a whole with one reason.

### Receipts via an AI assistant

Reading receipts needs no AI integration in Fridgora itself: any MCP client with vision (Claude
Desktop, claude.ai, …) does it.

1. The supplier sends the assistant a photo of the receipt.
2. The assistant matches lines to the catalogue with `list_catalog_products`, setting a
   `productId` only when sure, and divides multipacks into a price per piece.
3. It calls `create_stock_draft` with the lines and gets back a review link.
4. The supplier opens the link, picks products for unmatched lines, fixes prices and stocks
   everything at once.
5. The assistant can fix lines from chat with `update_stock_draft`; stocking happens on the web,
   or with `commit_stock_draft` once the supplier has seen the lines.

## Purchase groups

Nobody needs "Monster Mango Loco, Monster Ultra Zero and Monster Zero" on a shopping list — the
need is "an energy drink with sugar, and one without". A **purchase group** joins
interchangeable products (`Energy drink s cukrem`, `Tyčinky`, `Bonbony`…). The shopping list
plans a group as **one line**: how many pieces of the group to buy, whatever the flavour. The
group's best sellers are shown as hints.

- Groups belong to a category and are shared by all suppliers, like the catalogue. They are
  managed on the **Groups** tab of the products page or in the product form.
- Customers never see groups; the shop keeps using categories.

Products outside any group are planned on their own only once they are a **habit**: restocked
at least twice in the last 180 days and sold at least three times in the last 12 weeks. Everything
else is an experiment and stays off the list unless the supplier adds it.

## How the list is computed

All numbers come from `ShoppingListService` (`app/services/shopping/shopping_list_service.ts`);
the arithmetic lives in `app/services/shopping/demand_math.ts` and is unit-tested on its own.

**Sales rate.** For each product (or group) the last 12 weeks of sales are read per day. Only
days on which the item could be bought count — an empty shelf sells nothing, which says nothing
about demand. Availability is rebuilt backwards from today's stock using deliveries, sales and
write-offs. Days on which the whole fridge sold nothing (weekends, holidays) are ignored too.
Recent weeks weigh more (half-life 4 weeks), and one pseudo-day without a sale keeps a single
lucky day from reading as a full rate. For a group the rate is measured on the group's summed
sales, so a customer switching flavours does not count twice.

**Horizon.** How far ahead to buy — by default the supplier's habit: deliveries closer than six
hours are one trip, and the median gap between the last 180 days' trips is the horizon (14 days
when there are fewer than three trips). The slider overrides it for one list (1–60 days) and
"Back to usual" returns to the habit. The weekday pattern of the fridge turns calendar days into
expected working days.

**Quantity.** Order up to the expected sales until the next trip plus a safety margin of one
standard deviation (Poisson, ≈ 84 % chance not to run out), minus the stock:

```
demand   = rate × working days in the horizon
target   = demand + √demand
quantity = round up (target − stock) to the usual pack
```

The usual pack is read from the amounts the supplier stocked (48, 48, 24 → packs of 24). A small
need is not blown up: if a pack would be more than twice the need, whole pieces are suggested.
Lines are ordered by the chance to sell out before the next trip.

**Price.** The expected price per piece is the weighted median of the last six lots' purchase
prices. Without recorded purchase prices the selling price stands in, and the line says it is an
estimate. The **good price** is the cheapest quarter of the year's purchases — worth stocking up
at when a shop happens to sell below it. The suggested selling price is the cost plus the
supplier's margin, rounded up to whole crowns.

**Scope.** _Mine only_ covers what the supplier stocked in the last 180 days; _whole fridge_
covers everyone's. The category filter narrows either. Stock and demand are always the whole
fridge's — it is one shelf.

## Editing the list

The suggestions are recomputed on every visit; the list stores only what the supplier changed
(`shopping_lists`, `shopping_list_items`):

- **Quantity and price** overrides per line (the suggestion stays visible, one click resets it).
- **Own lines**: a catalogue product (a customer's wish, a promotion — it counts towards its
  group's need) or free text.
- **Ticks** for use in the shop, and **dismissed** suggestions (restorable).

**Finish shopping** turns the ticked lines (or all lines when nothing is ticked) into a stocking
draft in one transaction, closes the list and writes a `shopping_list.completed` audit entry; the
next visit starts a new one. Free-text lines have no product to stock, so they go into the
draft's note instead of becoming lines.

## Purchase price and margin

Every delivery may carry a **purchase price** (`deliveries.purchase_price`, two decimals) next
to the selling price customers pay (`price`, whole crowns). Both can be corrected later on the
History tab (`PUT /supplier/deliveries/:id`): a changed selling price reprices uninvoiced
purchases from the lot, a changed purchase price only fixes the books. The margin
(`users.margin_percent`, default 0 %) is set in the settings dialog on the earnings page. It only
**suggests** selling prices: the purchase price plus the margin, rounded up to whole crowns.
Changing it never touches the prices of stock already on the shelf.

**Change price** (stock table → tag icon) is for a sale or a price rise of what is still on the
shelf. The dialog lists the product's lots with pieces left, oldest first — the one that sells
first is marked — with who stocked them, the pieces left and the selling price. _Set for all of
mine_ (Enter or _Fill in_) puts one price on all your own lots; any row can then differ. You
change only your own lots (a colleague's price is shown read-only); an admin may change anyone's,
and the owner of a lot an admin repriced gets an e-mail. Saving sends only the changed rows
(`POST /supplier/stock/reprice` with `{ items: [{ deliveryId, price }] }`, whole crowns
1–100 000) in one transaction. Nothing sold changes — no order, no invoice, no buyer e-mail —
each lot gets a `reprice` correction record and the audit one `delivery.repriced` entry per lot
owner, product and new price. The lots come from `GET /supplier/stock/products/:productId/lots`
(no purchase prices — a colleague's is private). A typo in a lot is fixed on the History tab
instead (_Correct delivery_), which also reprices uninvoiced purchases.

## Shrinkage: write-offs and inventories

Pieces that leave the fridge without a sale are recorded as `stock_adjustments`, each with the
lot's purchase and selling price snapshotted. `deliveries.amount_lost` holds the net per lot, so
"sold" stays `amount_supplied − amount_left − amount_lost`.

The two tools answer different questions:

- **Write-off** (stock table → minus icon) is for pieces you **know about**: broken, expired,
  stolen or another reason you can name. Under the form the dialog lists the product's lots and
  previews live which of them the pieces will come off (FIFO across every supplier, the same plan
  the server follows — `inertia/composables/stock_fifo_rules.ts` mirrors
  `app/services/stock_fifo.ts`); a colleague's lot that gives pieces says they will get an
  e-mail. The server decides on its own; if a sale moved the pieces meanwhile, the confirmation
  says which lots they really came from.
- **Inventory count** (Stock › Inventory count tab) finds a shortfall you **then explain**. Enter
  what is on the shelf: missing pieces are written off, extra pieces go back onto the newest lot —
  the counter's own lot of that product something already left, when they have one. The sheet
  sends, per product, the stock it showed, when that stock was read (`asOf`) and when the
  product was counted. The server moves the stock on to the moment of counting — sales,
  deliveries and write-offs in between happened on the shelf too, and corrections another
  inventory committed since already fixed the same difference — so sales during the count are
  not mistaken for shrinkage and two people counting the same product do not write it off twice.
  The sheet also lists products at zero stock that had a delivery in the last 90 days, keeps what
  was counted across filters and reloads of the tab, and asks before leaving with counts unsaved.

An inventory's shortfall starts without a reason (`reason = inventory`, shown as "Not yet
given"). On the inventory's detail page every product with missing pieces has a reason select;
choosing one (`PUT /supplier/inventory/:id/products/:productId`) reclassifies all loss rows of
that product in that inventory — FIFO may have spread them over several lots — and writes a
`stock.reclassified` audit entry (`{ inventoryCountId, productId, from, to }`) for every supplier
whose lots it touched, aimed at them when someone else did it. Only the counter, an owner of a
touched lot or an admin may reclassify. A surplus has nothing to explain: its rows keep
`inventory` and are shown as "surplus from an inventory".

| Reason      | Czech label      | English label | Set by                                |
| ----------- | ---------------- | ------------- | ------------------------------------- |
| `inventory` | Zatím bez důvodu | Not yet given | An inventory, until a reason is given |
| `stolen`    | Odcizené         | Stolen        | A write-off or a classification       |
| `damaged`   | Poškozené        | Damaged       | A write-off or a classification       |
| `expired`   | Prošlé           | Expired       | A write-off or a classification       |
| `other`     | Jiný důvod       | Other         | A write-off or a classification       |

Losses come off the **oldest lots first** — exactly the pieces first-in-first-out would have
sold next, so an unpaid snack costs whoever's lot a paid one would have come from. When that is a
colleague's lot, the audit log says so to them, and they get an e-mail: one per write-off (who,
the product, how many pieces off which of their deliveries, the reason), and after an inventory
one summary of every product whose shortfall or surplus landed on their lots, with a link to the
inventory. Whoever did it gets none. Every write-off and inventory difference is listed on
Stock › History under the type _Write-offs and inventories_.

A **write-off entered by mistake** can be taken back for 7 days by whoever entered it (or an
admin): `PUT /supplier/stock/write-offs/:id/revert`. The pieces return onto the very lot they
came off (unless that lot was voided since), the row stays in the history marked as reverted
(`reverted_at`, `reverted_by`) and no longer counts as shrinkage; the audit gets
`stock.write_off_reverted`. An inventory difference cannot be reverted — the next inventory
corrects it.

## Earnings and the yearly limit

The earnings page shows, for a calendar year and the supplier's own lots: sales, the purchase
cost of what sold, gross profit, net profit, shrinkage (pieces, value at purchase and selling
price, loss rate, a breakdown by reason and the surpluses that offset it), and the **margin that
just covers the shrinkage** (`loss rate / (1 − loss rate)`), compared with the margin actually
achieved. Sales of lots without a purchase price are left out of the profit and counted
separately; where the profit covers only part of the sales the page says from how many pieces.
Under the figures one line shows where the money is: what the year's deliveries cost, the stock
at purchase price (plus pieces without one) and what colleagues owe — not invoiced yet and
unpaid invoices, linking to Invoicing and Payments. When an admin hands a leaving supplier's
stock over, the heir is taken to have bought it from them outside the app: the pieces leave the
leaving supplier's purchases and stock and join the heir's (dated like the original lot), while
the sales and debts made before the handover stay with the leaving supplier.

**Own consumption is not income.** When suppliers buy from their own lots
(`orders.buyer_id = deliveries.supplier_id`), nobody else paid them anything. Those pieces are
reported separately as _own consumption_ (pieces and what the supplier paid themselves) and are
left out of the sales, the cost of sales, the profit, the per-product breakdown and the yearly
limit. They did leave the shelf, so they count in the loss rate:
`net lost / (sold to others + own consumption + net lost)`.

**Shrinkage is valued at purchase prices** — what the missing pieces cost the supplier (the
selling price stands in where a lot has no purchase price); it never goes below zero, surpluses
are shown on their own. Net profit subtracts only the shrinkage of lots with a purchase price,
the same lots the gross profit is made of; without any purchase price it is not shown at all. The value at selling prices — what colleagues
did not pay — is shown next to it.

An instance can set a yearly limit a supplier should stay under. It counts **money received**:
invoices other people paid, by the date they were paid (`invoices.paid_at`, in the fridge's
timezone) — a December purchase paid in January is January's income. Own consumption
(self-invoices) never counts, a rejected payment drops out again. Next to it the page shows what
is **pending**: unpaid invoices and purchases not invoiced yet. Sales on the earnings page stay
by the purchase date. The earnings page shows the progress and the stock page warns from 80 % on.
Exceeding the limit **only shows a warning**: nothing is blocked and no e-mail is sent.

| Variable                             | Default | Meaning                                  |
| ------------------------------------ | ------- | ---------------------------------------- |
| `SUPPLIER_INCOME_LIMIT`              | (off)   | The yearly amount; empty or 0 = no limit |
| `SUPPLIER_INCOME_LIMIT_WARN_PERCENT` | `80`    | Warn from this share of the limit        |

In the Czech Republic, occasional income ("příležitostný příjem", § 10 odst. 3 písm. a) zákona o
daních z příjmů) is tax-exempt up to **50 000 Kč of income per calendar year** (30 000 Kč before
2024). The limit applies to income, not to profit, and once exceeded the whole amount is
taxable. Counting by the payment date is the app's reading; this is not tax or legal advice —
check your own situation.

## MCP tools

Everything above is also available to an AI assistant; `docs/mcp.md` has the full reference and
the rules for choosing between tools.

| Tool                                              | What it does                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `add_stock`                                       | One lot the user described themselves; takes `purchasePrice`, derives the selling price from the margin, warns about a duplicate lot or an unusual price until `confirmWarnings` |
| `create_stock_draft`                              | A stocking draft for the supplier to review — e.g. from a receipt                                             |
| `list_stock_drafts` / `get_stock_draft`           | Open drafts; the lines of one draft and what blocks stocking it                                               |
| `update_stock_draft` / `discard_stock_draft`      | Replace all lines of an open draft from chat; throw it away                                                   |
| `commit_stock_draft`                              | Stock a draft — only after the supplier saw the lines; same duplicate/price warnings as the web               |
| `write_off_stock`                                 | Known losses (expired, damaged, stolen, other) off the oldest lots                                            |
| `list_stock_lots` / `reprice_stock`               | The lots of a product with pieces left (FIFO order); a new selling price for all your lots or exact lots      |
| `record_inventory_count` / `classify_inventory_loss` | A shelf count (`expected` from `get_stock`); a reason for its shortfall                                    |
| `void_delivery` / `correct_delivery`              | Cancel a lot nothing sold from; fix a lot's pieces, selling or purchase price                                 |
| `get_shopping_list`                               | The list with the saved settings, or others for one question (scope `mine` / `all`)                          |
| `update_shopping_list_line` / `add_shopping_list_line` | Change a saved line from chat (pieces, price, tick, hide, note); put a product or free text on the list  |
| `list_product_groups` / `create_product_group`    | Purchase groups and their products; a new group (idempotent by name — an existing one gets the products added) |
| `get_finance_summary`                             | Sales to others, own consumption, cost, profit, shrinkage (by reason), break-even margin and the yearly limit |
| `create_product` / `update_product`               | Take `groupId`                                                                                                |

## Store promotions (not implemented)

Comparing the list with current promotions in shops would be a natural next step: a deal is
worth it when its price per piece is below the line's expected cost, and a stock-up when it is at
or below the good price. The list already exposes both numbers, so a promotion source would only
need to map offers onto products or groups.

There is no source yet. [kupi.cz](https://www.kupi.cz), the obvious Czech one, has no API or data
feed, and its [terms](https://o-seznam.cz/napoveda/smluvni-podminky-sluzby-kupi-cz/) forbid
automated extraction of its database. A deployment that wants promotions should use a source it
is allowed to use; [Open Prices](https://prices.openfoodfacts.org) (Open Food Facts, by EAN) is
open but has little Czech data so far.
