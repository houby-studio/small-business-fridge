# Shopping list, stocking drafts, purchase prices and shrinkage

Everything a supplier needs between two shopping trips: what to buy, how much and for how much;
stocking a whole receipt at once; and knowing what the fridge really earns once missing pieces
are counted. All of it works from the fridge's own data — no external price feed is needed.

## Where things live

The supplier menu has seven entries. Two of them are the home of this feature, the rest gained
tabs or settings.

| Menu entry      | URL                        | What it is for                                                                       |
| --------------- | -------------------------- | ------------------------------------------------------------------------------------ |
| Stock           | `/supplier/stock`          | Tabs **Stock** (one table with filters, row actions _Stock_ and _Write off_), **History** (deliveries, or write-offs and inventory differences) and **Inventory count** |
| Receiving       | `/supplier/stock/drafts`   | Stocking drafts (_příjemky_) — the only way stock enters the fridge; the badge counts open drafts |
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

- The supplier's open manual draft is reused: **Stock** on the stock page, the row action on a
  product, or saving a new product all append a line to it (`POST /supplier/stock/drafts` with an
  optional `productId`) and open the draft with that line's amount focused. Three clicks on three
  products build one draft with three lines.
- The page always ends with an empty line. Picking a product fills the last purchase and selling
  prices in as values; Enter moves through amount, purchase price and selling price, and Enter on
  the selling price confirms the line and opens the next one. Ctrl+Enter stocks the draft. One
  item is stocked in three interactions: type the product and press Enter, type the amount and
  press Enter, press **Stock**.
- An empty selling price is the purchase price plus the supplier's margin, rounded up to whole
  crowns.
- Before stocking, every line is checked for a **duplicate** (the same supplier stocked the same
  product within 30 minutes) and an **unusual price** (1.5× away from the last delivery). The
  draft page shows them in one dialog with _Stock anyway_; MCP returns them and asks for
  `confirmWarnings`.
- Empty drafts are not counted anywhere; the menu badge and the chip on the stock page count
  open drafts with at least one line.

Drafts come from three places: by hand (above), from the shopping list (**Finish shopping**) and
from an AI assistant over MCP, typically a receipt photo (below). Each draft shows its source.

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

## Shrinkage: write-offs and inventories

Pieces that leave the fridge without a sale are recorded as `stock_adjustments`, each with the
lot's purchase and selling price snapshotted. `deliveries.amount_lost` holds the net per lot, so
"sold" stays `amount_supplied − amount_left − amount_lost`.

The two tools answer different questions:

- **Write-off** (stock table → minus icon) is for pieces you **know about**: broken, expired,
  stolen or another reason you can name.
- **Inventory count** (Stock › Inventory count tab) finds a shortfall you **then explain**. Enter
  what is on the shelf: missing pieces are written off, extra pieces go back onto the newest lot —
  the counter's own newest lot of that product when they have one. The counter's view of the
  stock is sent with the count, so whatever sells between counting and saving is not mistaken for
  shrinkage.

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
colleague's lot, the audit log says so to them. Every write-off and inventory difference is listed
on Stock › History under the type _Write-offs and inventories_.

## Earnings and the yearly limit

The earnings page shows, for a calendar year and the supplier's own lots: sales, the purchase
cost of what sold, gross profit, net profit, shrinkage (pieces, value at purchase and selling
price, loss rate, a breakdown by reason and the surpluses that offset it), and the **margin that
just covers the shrinkage** (`loss rate / (1 − loss rate)`), compared with the margin actually
achieved. Sales of lots without a purchase price are left out of the profit and counted
separately.

**Own consumption is not income.** When suppliers buy from their own lots
(`orders.buyer_id = deliveries.supplier_id`), nobody else paid them anything. Those pieces are
reported separately as _own consumption_ (pieces and what the supplier paid themselves) and are
left out of the sales, the cost of sales, the profit, the per-product breakdown and the yearly
limit. They did leave the shelf, so they count in the loss rate:
`net lost / (sold to others + own consumption + net lost)`.

**Shrinkage is valued at purchase prices** — what the missing pieces cost the supplier, and what
net profit subtracts (the selling price stands in where a lot has no purchase price); it never
goes below zero, surpluses are shown on their own. The value at selling prices — what colleagues
did not pay — is shown next to it.

An instance can set a yearly limit a supplier should stay under. Only **sales to other people**
count towards it. The earnings page shows the progress and the stock page warns from 80 % on.
Exceeding the limit **only shows a warning**: nothing is blocked and no e-mail is sent.

| Variable                             | Default | Meaning                                  |
| ------------------------------------ | ------- | ---------------------------------------- |
| `SUPPLIER_INCOME_LIMIT`              | (off)   | The yearly amount; empty or 0 = no limit |
| `SUPPLIER_INCOME_LIMIT_WARN_PERCENT` | `80`    | Warn from this share of the limit        |

In the Czech Republic, occasional income ("příležitostný příjem", § 10 odst. 3 písm. a) zákona o
daních z příjmů) is tax-exempt up to **50 000 Kč of income per calendar year** (30 000 Kč before
2024). The limit applies to income — sales — not to profit, and once exceeded the whole amount is
taxable. This is not legal advice; check your own situation.

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
