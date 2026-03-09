# Kupi.cz Sidecar — Design Document

> Reference doc for future implementation of the kupi.cz discount scraper integration.
> Last updated: 2026-03-08

---

## 1. Overview and Goals

The sidecar is a separate Python application that scrapes [kupi.cz](https://www.kupi.cz) for
current product discounts and exposes them to the main SBF (Small Business Fridge) app so that
**suppliers can make smarter purchasing decisions**.

Concretely, a supplier should be able to open a page in SBF and see:

- "Lidl has **5** products from your catalog where the deal price is at or below your usual cost"
- "Kaufland has **2** worth considering (slightly above usual cost)"
- Drill into Lidl → shopping list: Mattoni **0.75L** at 12 Kč (you last paid 14 Kč ✓ buy) —
  the 1.5L Mattoni deal is not shown here even if cheaper per-ml, because it's a different product
- Kofola **1L** at 26 Kč (you last paid 24 Kč — consider)
- "Red Bull **250ml**: **3 left** — 4-pack for 99 Kč at Albert = 24.75 Kč each (you last paid 25 Kč ✓ buy)"

The primary value is matching deal prices against the supplier's **own historical delivery cost**,
not against an abstract "discount percentage". A 30 % off deal is useless if the item was already
marked up to begin with.

---

## 2. Why a Separate Repository

- `kupiapi` is a Python library (`pip install kupiapi`) — running it inside a Node.js process
  requires spawning subprocesses, which is fragile
- The feature is Czech-market specific; keeping it out of the main repo lets SBF remain
  locale-neutral
- Independent deployment, versioning, and lifecycle
- The entire feature is opt-in — deployments that don't set `KUPI_SIDECAR_URL` see nothing

---

## 3. Communication Architecture: REST API + Optional MCP

### 3.1 Primary: REST API (implement first)

The sidecar exposes a small HTTP API. SBF calls it on demand (when a supplier loads the deals
page) and caches results. **End users never interact with the sidecar directly** — every call goes
through SBF's own supplier controllers, which apply the normal role-based auth and return Inertia
pages. The sidecar is an internal implementation detail.

```
Supplier browser
      │  (normal Inertia navigation)
      ▼
SBF (AdonisJS)  ──── HTTP + API key ────►  Kupi Sidecar (FastAPI, internal only)
      │                                            │
      │  serves Inertia pages                APScheduler (daily scrape)
      │  via /supplier/deals/*                     │
      │                                      PostgreSQL (shared instance,
      │  exposes /api/kupi/catalog ◄──────── separate "kupi_sidecar" database)
      │  (sidecar pulls this to build             │
      │   suggestions)                       kupi.cz (web scraping)
```

The sidecar is **never exposed to the internet**. It sits behind the internal Docker network.

### 3.2 Optional: MCP Server (implement later)

On top of the same sidecar, optionally expose a
[Model Context Protocol](https://modelcontextprotocol.io) server so that a Claude-powered supplier
assistant can query deals in natural language.

```
Supplier chat UI ──► Claude (Anthropic API) ──► MCP Server (fastmcp, port 8001)
                                                        │
                                                  same sidecar process,
                                                  same internal service layer
```

MCP tools (examples):
- `get_shop_ranking()` — "which shops have products I can actually save money on?"
- `get_buy_signals()` — "what should I buy this week based on my delivery history?"
- `get_low_stock_deals()` — "what's almost out of stock AND worth buying today?"
- `build_shopping_list(shop)` — "give me a Lidl list sorted by priority"

**Rule**: MCP is a thin wrapper over the same Python service layer. It does not call the REST API
internally — both the REST routes and the MCP tools call the same service functions directly.

---

## 4. Authentication Model

Both sides share a single pre-shared API key that lives in **one `.env` file** (the main SBF
`.env`). The sidecar reads it from the same file (mounted as a Docker secret or env var).

```env
# .env (SBF — single source of truth)
KUPI_SIDECAR_URL=http://kupi-sidecar:8000    # empty = feature disabled everywhere
KUPI_API_KEY=some-random-secret-here         # shared by SBF and sidecar
```

- SBF sends `X-API-Key: ${KUPI_API_KEY}` on every request to the sidecar
- Sidecar validates the header and rejects anything else with 401
- The catalog endpoint (`GET /api/kupi/catalog`) that the sidecar calls on SBF uses the same key:
  sidecar sends `X-API-Key: ${KUPI_API_KEY}`, SBF validates it

No user tokens, no OAuth — it is a service-to-service secret, and both parties read the same
`.env`. Simple and sufficient for a self-hosted deployment.

---

## 5. Sidecar Repository Structure

```
kupi-sidecar/
├── app/
│   ├── scraper/
│   │   ├── kupi_client.py          # Thin wrapper around kupiapi library
│   │   ├── product_matcher.py      # Fuzzy matching: kupi deal names → SBF product names
│   │   └── unit_parser.py          # Multipack/unit normalization (per-unit price)
│   ├── models/
│   │   ├── deal.py                 # SQLAlchemy: raw scraped deals
│   │   ├── product_mapping.py      # Manual/confirmed product → search term overrides
│   │   └── suggestion.py           # Computed suggestions (deal × SBF product × price signal)
│   ├── services/
│   │   ├── scrape_service.py       # Orchestrates scraping all configured shops/categories
│   │   ├── catalog_service.py      # Fetches SBF product catalog (via REST)
│   │   ├── suggestion_service.py   # Builds suggestions: fuzzy match + price signal
│   │   └── shop_ranking_service.py # Aggregates per-shop "buy" and "consider" counts
│   ├── api/
│   │   ├── routes.py               # FastAPI route definitions
│   │   └── schemas.py              # Pydantic request/response models
│   ├── scheduler/
│   │   └── tasks.py                # APScheduler job definitions
│   └── mcp/
│       └── server.py               # fastmcp MCP server (opt-in, built in a later phase)
├── migrations/                     # Alembic DB migrations
├── config.py                       # Pydantic BaseSettings — all config from env
├── main.py                         # FastAPI app entry point
├── requirements.txt
└── Dockerfile
```

---

## 6. Database Schema (sidecar — separate DB on shared Postgres instance)

### `deals` — raw scraped data (one row per product × shop combination)

```sql
CREATE TABLE deals (
  id                    SERIAL PRIMARY KEY,
  scraped_at            TIMESTAMPTZ NOT NULL,
  kupi_category         VARCHAR(120),           -- kupi slug, e.g. "napoje"
  product_name          VARCHAR(255) NOT NULL,  -- as scraped, e.g. "Red Bull 4 × 250 ml"
  shop                  VARCHAR(100) NOT NULL,  -- e.g. "Lidl"
  total_price           NUMERIC(8,2),           -- price as listed (may cover a whole multipack)
  amount                VARCHAR(60),            -- raw string, e.g. "4 × 250 ml", "1.5 l"
  pack_count            SMALLINT NOT NULL DEFAULT 1,   -- number of items in one listed price
  per_unit_price        NUMERIC(8,2),           -- total_price / pack_count
  unit_size_normalized  INTEGER,                -- size of ONE item in canonical units (NULL=unknown)
  unit_size_type        VARCHAR(4),             -- 'ml' | 'g' | NULL
  valid_until           VARCHAR(60),
  is_current            BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX ON deals (shop, is_current);
CREATE INDEX ON deals (kupi_category, is_current);
CREATE INDEX ON deals (unit_size_normalized, unit_size_type, is_current);
```

All three computed columns (`pack_count`, `per_unit_price`, `unit_size_normalized`,
`unit_size_type`) are populated at scrape/insert time by `unit_parser.py` (see section 8).
Price comparisons always use `per_unit_price`. Size-gating uses `unit_size_normalized` +
`unit_size_type` together.

### `product_mappings` — optional manual overrides

```sql
CREATE TABLE product_mappings (
  id               SERIAL PRIMARY KEY,
  sbf_product_id   INTEGER NOT NULL,
  sbf_product_name VARCHAR(255) NOT NULL,  -- denormalised for display
  search_term      VARCHAR(120) NOT NULL,  -- override what to search/match on kupi
  pack_count_override        SMALLINT,    -- override auto-parsed pack count for price calc
  expected_unit_size_norm    INTEGER,     -- override expected unit size (in ml or g)
  expected_unit_size_type    VARCHAR(4),  -- 'ml' | 'g' — must be set together with above
  confirmed                  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                 TIMESTAMPTZ DEFAULT NOW()
);
```

### `suggestions` — pre-computed results including price signal

```sql
CREATE TABLE suggestions (
  id                   SERIAL PRIMARY KEY,
  generated_at         TIMESTAMPTZ NOT NULL,
  sbf_product_id       INTEGER NOT NULL,
  sbf_product_name     VARCHAR(255) NOT NULL,
  deal_id              INTEGER REFERENCES deals(id),
  shop                 VARCHAR(100) NOT NULL,
  deal_per_unit_price  NUMERIC(8,2),         -- deals.per_unit_price (multipack-normalised)
  last_delivery_price  NUMERIC(8,2),         -- from SBF catalog at scrape time (per unit)
  price_ratio          NUMERIC(6,4),         -- deal_per_unit_price / last_delivery_price
  price_signal         VARCHAR(10) NOT NULL, -- 'buy' | 'consider' | 'skip' | 'unknown'
  match_score          NUMERIC(5,4),         -- fuzzy match confidence 0–1
  stock_left           INTEGER,              -- summed amountLeft from SBF
  is_low_stock         BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX ON suggestions (shop, price_signal, generated_at);
CREATE INDEX ON suggestions (is_low_stock, price_signal, generated_at);
```

---

## 7. Price Signal — Core Decision Logic

This replaces "avg discount %" as the primary metric. The insight is that the supplier already
knows what they usually pay. A deal is only actionable if the deal price is at or below that
reference point.

```python
# config.py
CONSIDER_THRESHOLD = float(os.getenv("CONSIDER_THRESHOLD", "1.10"))
# per_unit deal price up to 10% above last_delivery_price → "consider"
# configurable: some suppliers may want 1.05, others 1.15

def compute_price_signal(per_unit_price: Decimal | None, last_delivery_price: Decimal | None) -> str:
    if per_unit_price is None or last_delivery_price is None or last_delivery_price == 0:
        return "unknown"   # no basis for comparison
    ratio = float(per_unit_price) / float(last_delivery_price)
    if ratio <= 1.0:
        return "buy"       # at or below usual per-unit cost — clear opportunity
    elif ratio <= CONSIDER_THRESHOLD:
        return "consider"  # slightly above usual cost, supplier's discretion
    else:
        return "skip"      # too expensive, not worth it
```

Both sides of the comparison are **per-unit prices**:
- `per_unit_price` from `deals` table — multipack-normalised by `unit_parser.py` at scrape time
  (e.g. 4×Red Bull for 99 Kč → `per_unit_price = 24.75`)
- `last_delivery_price` from SBF's `deliveries.price` — already per-unit since that is what the
  supplier pays per item when they restock SBF

This means "I always buy Red Bull for 25 Kč each" is correctly compared against "4-pack for 99 Kč
→ 24.75 Kč each → buy signal".

### Shop ranking metric (replaces avg discount %)

```python
# shop_ranking_service.py
# For each shop, count how many matched products have each signal
{
  "shop": "Lidl",
  "buy_count": 5,        # products where deal_price <= last_delivery_price
  "consider_count": 2,   # products slightly above usual cost
  "skip_count": 1,       # products more expensive than usual
  "unknown_count": 0,    # products with no delivery history
  "low_stock_buy_count": 2  # subset of buy_count that are also running low
}
```

Shops are ranked primarily by `buy_count` descending, then `consider_count`. A shop with 5 "buy"
signals is strictly more valuable than one with 10 "skip" signals.

---

## 8. Unit / Multipack Normalization and Size Matching

The unit parser does two separate jobs that must not be confused:

1. **Pack count** (`pack_count`) — how many individual items are in the listed price. Divides
   `total_price` to produce `per_unit_price`. Used for the price signal.
2. **Unit size** (`unit_size_normalized` + `unit_size_type`) — the physical size/volume of one
   individual item. Used as a **hard filter** to prevent wrong-size matches.

These are independent. "4 × 250 ml Red Bull for 99 Kč" has `pack_count=4` and
`unit_size_normalized=250, unit_size_type='ml'`. The price signal uses the former; size-gating
uses the latter.

### Why size is a hard filter, not a score

A 2L Mattoni may be a better value per-ml than a 0.5L bottle, but **it is a different product for
office fridge restocking purposes**. Suppliers buy the size their customers consume — quick
single-serving drinks, not large bottles. A cheaper 2L deal must never surface as a suggestion
for a 0.5L product, regardless of economics.

Matches where sizes differ are silently dropped before writing to `suggestions`. There is no
score penalty — they are simply excluded.

### What the kupiapi library returns

The `amount` field is a raw scraped string encoding both the pack count and the individual size:

| `amount` | `pack_count` | `unit_size_normalized` | `unit_size_type` |
|---|---|---|---|
| `"4 × 250 ml"` | 4 | 250 | ml |
| `"6 × 330 ml"` | 6 | 330 | ml |
| `"2 × 1.5 l"` | 2 | 1500 | ml |
| `"6 ks"` | 6 | NULL | NULL |
| `"1.5 l"` | 1 | 1500 | ml |
| `"250 ml"` | 1 | 250 | ml |
| `"500 g"` | 1 | 500 | g |
| `"2 × 50 g"` | 2 | 50 | g |
| `None` | 1* | NULL | NULL |

\* fallback to product name for pack count if amount is missing (see below).

Volume is always normalised to **ml** (so 1.5 l → 1500 ml, 0.33 l → 330 ml).
Weight is always normalised to **g** (so 1 kg → 1000 g).
`unit_size_type` distinguishes them so ml and g are never compared against each other.

### Parsing code (`unit_parser.py`)

```python
import re
from decimal import Decimal
from dataclasses import dataclass

# "4 × 250 ml"  "4x330ml"  "4 × 1.5 l"
_MULTI_RE = re.compile(
    r'^(\d+)\s*[×xX]\s*([\d.,]+)\s*(ml|l|g|kg|ks)\b', re.UNICODE | re.IGNORECASE
)
# "6 ks"  (pieces with no size)
_KS_RE = re.compile(r'^(\d+)\s*ks\b', re.UNICODE | re.IGNORECASE)
# Single unit: "250 ml"  "1.5 l"  "500 g"
_SINGLE_RE = re.compile(r'^([\d.,]+)\s*(ml|l|g|kg)\b', re.UNICODE | re.IGNORECASE)
# Fallback pack count from product name: "Red Bull 4pack", "4 × Red Bull"
_NAME_PACK_RE = re.compile(
    r'(\d+)\s*[×xX]\s*\d|(\d+)\s*-?\s*pack', re.UNICODE | re.IGNORECASE
)

_ML_FACTORS = {"ml": 1, "l": 1000}
_G_FACTORS  = {"g": 1, "kg": 1000}


def _normalise(value_str: str, unit: str) -> tuple[int, str] | tuple[None, None]:
    """Convert a value+unit pair to (normalised_int, canonical_type)."""
    val = float(value_str.replace(",", "."))
    u = unit.lower()
    if u in _ML_FACTORS:
        return round(val * _ML_FACTORS[u]), "ml"
    if u in _G_FACTORS:
        return round(val * _G_FACTORS[u]), "g"
    return None, None


@dataclass
class ParsedUnit:
    pack_count: int                   # number of items in one listed price
    unit_size_normalized: int | None  # size of one item in canonical units
    unit_size_type: str | None        # 'ml' | 'g' | 'ks' | None


def parse_amount(amount: str | None, product_name: str | None = None) -> ParsedUnit:
    """Parse kupi amount string into pack count and individual unit size."""
    if amount:
        s = amount.strip()

        m = _MULTI_RE.match(s)
        if m:
            pack = int(m.group(1))
            size, stype = _normalise(m.group(2), m.group(3))
            return ParsedUnit(pack, size, stype)

        m = _KS_RE.match(s)
        if m:
            return ParsedUnit(int(m.group(1)), None, None)

        m = _SINGLE_RE.match(s)
        if m:
            size, stype = _normalise(m.group(1), m.group(2))
            return ParsedUnit(1, size, stype)

    # Fallback: try to get pack count from product name
    pack = 1
    if product_name:
        m = _NAME_PACK_RE.search(product_name)
        if m:
            pack = int(m.group(1) or m.group(2))

    return ParsedUnit(pack, None, None)


def compute_per_unit_price(total_price: Decimal | None, pack_count: int) -> Decimal | None:
    if total_price is None or pack_count <= 0:
        return None
    return (total_price / pack_count).quantize(Decimal("0.01"))
```

### Usage at scrape time

```python
# in scrape_service.py, for each raw deal returned by kupiapi:
parsed = parse_amount(raw["amounts"][i], raw["name"])
per_unit_price = compute_per_unit_price(parsed_price, parsed.pack_count)

deal = Deal(
    product_name=raw["name"],
    shop=raw["shops"][i],
    total_price=parsed_price,
    amount=raw["amounts"][i],
    pack_count=parsed.pack_count,
    per_unit_price=per_unit_price,
    unit_size_normalized=parsed.unit_size_normalized,
    unit_size_type=parsed.unit_size_type,
    ...
)
```

### Size-matching at suggestion time

```python
SIZE_TOLERANCE = float(os.getenv("SIZE_TOLERANCE", "0.05"))  # 5% — handles 0.33l vs 330ml rounding

def sizes_compatible(
    deal_size: int | None, deal_type: str | None,
    product_size: int | None, product_type: str | None,
) -> bool:
    """
    Returns True if the deal's individual unit size is compatible with the product's expected size.
    If either side has no size info, returns True (can't rule it out — rely on name match alone).
    """
    if deal_size is None or product_size is None:
        return True   # unknown — don't exclude, but match_score will be lower
    if deal_type != product_type:
        return False  # ml vs g — completely incompatible
    ratio = abs(deal_size - product_size) / product_size
    return ratio <= SIZE_TOLERANCE
```

Applied in `suggestion_service.py` before any fuzzy name scoring:
```python
candidates = [
    deal for deal in category_deals
    if sizes_compatible(
        deal.unit_size_normalized, deal.unit_size_type,
        product["unitSizeNormalized"], product["unitSizeType"],
    )
]
matches = match_deals_to_product(product["displayName"], candidates)
```

A 2L Mattoni deal never reaches the fuzzy matcher when the SBF product is 0.5L. The filter is
silent — it does not produce a "skip" signal, the deal simply does not appear.

### Edge cases

- **NULL size on deal side** — amount was unparseable (e.g. "bal." or missing). Size check skipped;
  deal included as a fuzzy-match candidate with a note in the shopping list UI.
- **NULL size on product side** — product displayName has no recognisable size token (e.g. "Chips
  mix"). Size check skipped; fuzzy name match is the only gate.
- **Manual overrides**: `product_mappings` has `unit_count_override` (for price) and
  `expected_unit_size_ml` (for size gate) to handle products where parsing consistently fails.

---

## 9. Product Matching Strategy  <!-- was §8 before unit normalization section was added -->

SBF product names (e.g. "Mattoni perlivá 0.75L") vs kupi.cz deal names
("Mattoni perlivá voda 0.75 l") need fuzzy matching.

### Strategy 1: Category bulk scrape + fuzzy match (primary)

1. Admin maps each SBF category to one or more kupi.cz slugs (SBF DB: `kupi_category_mappings`)
2. Daily scrape of all mapped categories
3. `rapidfuzz.token_sort_ratio` match: each SBF product name vs each deal name in the category
4. Keep matches ≥ `MATCH_THRESHOLD` (default: 70)
5. Store as suggestions

### Strategy 2: Per-product name search (supplementary)

- Products with no category mapping or no confident match: call
  `get_discounts_by_search(product.displayName)` per-product
- Rate-limited, lower-priority background step after the main category scrape

### Strategy 3: Manual mappings (override, highest priority)

- Supplier creates explicit mapping: "Red Bull 0.25L" → search term `"red bull 250"`
- Stored in `product_mappings`, always wins over fuzzy matches
- UI: `/supplier/deals/mappings`

```python
# product_matcher.py
from rapidfuzz import fuzz, process

def match_deals_to_product(product_name: str, deals: list[dict], threshold: int = 70) -> list[dict]:
    deal_names = [d["name"] for d in deals]
    results = process.extract(product_name, deal_names, scorer=fuzz.token_sort_ratio, limit=5)
    return [
        {**deals[idx], "match_score": score / 100}
        for _, score, idx in results
        if score >= threshold
    ]
```

---

## 9. Sidecar Configuration (environment variables)

```env
DATABASE_URL=postgresql://user:pass@postgres:5432/kupi_sidecar

# SBF connection (sidecar pulls catalog from SBF, same key SBF uses to call sidecar)
SBF_BASE_URL=http://sbf-app:3333
KUPI_API_KEY=some-random-secret-here    # single shared secret, read from SBF's .env

# Scraping config
SCRAPE_CRON=0 3 * * *                  # default: 03:00 daily
KUPI_SHOPS=Lidl,Albert,Kaufland,Tesco  # comma-separated; scrape only these shops
                                        # if empty, scrape all shops in configured categories

# Matching and signal thresholds
MATCH_THRESHOLD=70                     # fuzzy match minimum score (0–100)
CONSIDER_THRESHOLD=1.10                # ratio above last_delivery_price to still show "consider"
LOW_STOCK_THRESHOLD=5                  # amountLeft below this → is_low_stock = true

# Optional MCP server
MCP_ENABLED=false
MCP_PORT=8001

LOG_LEVEL=INFO
```

`KUPI_SHOPS` scopes the scraping to relevant retailers. The library's
`get_discounts_by_category_shop(category, shop)` method is used when both are specified, reducing
scraped noise significantly.

---

## 10. REST API Endpoints

All endpoints require `X-API-Key` header matching `KUPI_API_KEY`.

```
GET  /health
     → {status, last_scrape_at, deal_count, suggestion_count}

GET  /categories
     → list of kupi.cz category slugs available for mapping

GET  /shop-summary
     → [{shop, buy_count, consider_count, skip_count, unknown_count, low_stock_buy_count}, ...]
       sorted by buy_count desc

GET  /shopping-list/{shop}
     → deals at {shop} matched to SBF products
       sorted by: is_low_stock desc, price_signal (buy first), match_score desc
       each item: {sbf_product_name, deal_per_unit_price, last_delivery_price, price_ratio, price_signal,
                   deal_name, amount, valid_until, match_score, stock_left, is_low_stock}

GET  /suggestions
     ?price_signal=buy,consider    (filter by signal, comma-separated)
     ?low_stock_only=true
     ?shop=Lidl
     → flat list of suggestions matching the filters

GET  /mappings
POST /mappings          {sbf_product_id, sbf_product_name, search_term}
DELETE /mappings/{id}

POST /admin/trigger-scrape
     → fires immediate scrape (idempotent if one is already running)

GET  /admin/match-preview?q=mattoni
     → raw kupi results for a query, useful when creating manual mappings
```

---

## 11. SBF Catalog Endpoint (SBF exposes, sidecar calls)

`GET /api/kupi/catalog` — internal, authenticated with `X-API-Key: ${KUPI_API_KEY}`.

Response per product:

```json
[
  {
    "id": 42,
    "displayName": "Mattoni perlivá 0.75L",
    "barcode": "8594003720022",
    "kupiSlugs": ["napoje"],
    "stockLeft": 7,
    "lastDeliveryPrice": "14.50",
    "unitSizeNormalized": 750,
    "unitSizeType": "ml"
  }
]
```

`lastDeliveryPrice` — from `SELECT price FROM deliveries WHERE product_id = ? ORDER BY
created_at DESC LIMIT 1`. `NULL` if no delivery exists yet → price signal will be `"unknown"`.

`unitSizeNormalized` + `unitSizeType` — parsed from `displayName` by the **same `unit_parser`
logic** (reused in Node.js, or the catalog endpoint runs a small Python helper). Examples:
- `"Mattoni perlivá 0.75L"` → 750, "ml"
- `"Red Bull 250ml"` → 250, "ml"
- `"Tatranky 50g"` → 50, "g"
- `"Chips mix"` → null, null (no size token found — size gate disabled for this product)

`NULL` values mean the sidecar skips size-gating for that product and relies on name matching
alone. This is acceptable for products where size is not in the name (or irrelevant).

`kupiSlugs` — joined from `kupi_category_mappings` on the product's `categoryId`.

---

## 12. SBF-Side Changes

### 12.1 Environment variables

```env
KUPI_SIDECAR_URL=http://kupi-sidecar:8000   # unset = feature invisible
KUPI_API_KEY=some-random-secret-here
```

### 12.2 New DB table (SBF): `kupi_category_mappings`

```sql
CREATE TABLE kupi_category_mappings (
  id              SERIAL PRIMARY KEY,
  sbf_category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  kupi_slug       VARCHAR(120) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (sbf_category_id, kupi_slug)
);
```

### 12.3 New service: `KupiSidecarService`

`app/services/kupi_sidecar_service.ts` — thin HTTP client, all logic in Python sidecar.

```typescript
export default class KupiSidecarService {
  isAvailable(): boolean                                          // false if KUPI_SIDECAR_URL unset
  async getShopSummary(): Promise<ShopSummary[]>
  async getShoppingList(shop: string): Promise<ShoppingListItem[]>
  async getSuggestions(filters?: SuggestionFilters): Promise<Suggestion[]>
  async getMappings(): Promise<ProductMapping[]>
  async createMapping(data: CreateMappingDto): Promise<ProductMapping>
  async deleteMapping(id: number): Promise<void>
  async triggerScrape(): Promise<void>                           // admin only
}
```

### 12.4 New supplier pages

| Route | Vue page | Description |
|---|---|---|
| `GET /supplier/deals` | `supplier/Deals.vue` | Shop summary ranked by buy signals + restock alerts |
| `GET /supplier/deals/shopping-list/:shop` | `supplier/DealsShoppingList.vue` | Per-shop list with price signal badges |
| `GET /supplier/deals/mappings` | `supplier/DealsMappings.vue` | Manage product → search term overrides |

The `/supplier/deals` page layout:
1. **Restock now** — products that are `is_low_stock = true` AND `price_signal = 'buy'`
2. **Shop summary** — ranked table: "Lidl: 5 buy, 2 consider · Albert: 2 buy, 1 consider"
3. Links to each shop's full shopping list

### 12.5 New admin page

`GET /admin/kupi-settings` — category → kupi slug mappings, trigger scrape, view scrape status.

---

## 13. Daily Scrape Flow

```
03:00 UTC  APScheduler fires
           │
           ├─ fetch SBF catalog
           │   GET {SBF_BASE_URL}/api/kupi/catalog
           │   → [{id, displayName, barcode, kupiSlugs[], stockLeft, lastDeliveryPrice}]
           │
           ├─ mark all deals is_current = FALSE
           │
           ├─ for each kupi slug in catalog × each configured shop (KUPI_SHOPS):
           │   kupi_client.get_discounts_by_category_shop(slug, shop) → deals[]
           │   (falls back to get_discounts_by_category(slug) if KUPI_SHOPS is empty)
           │   insert new deals with is_current = TRUE
           │
           ├─ for each unmatched SBF product (no category mapping or low confidence):
           │   kupi_client.get_discounts_by_search(product.displayName) → supplementary deals
           │
           ├─ run fuzzy matching + price signal computation:
           │   for each SBF product × matching deals:
           │     compute match_score (rapidfuzz)
           │     compute price_ratio = deal_price / lastDeliveryPrice
           │     compute price_signal ('buy' | 'consider' | 'skip' | 'unknown')
           │     compute is_low_stock = (stockLeft <= LOW_STOCK_THRESHOLD)
           │   insert into suggestions (replace previous batch)
           │
           └─ log: N deals scraped, M suggestions (X buy, Y consider, Z skip)
```

---

## 14. On Supplier vs Customer Recommendations

The existing `Recommendation` model and `RecommendationService` are **customer-facing**: they
predict which in-stock products a customer is likely to want to buy next, based on their purchase
history. The `model` column (`statistical` | `lightgbm`) reflects this.

The kupi sidecar addresses a **completely different problem**: helping a supplier decide what to
physically purchase and restock. These are separate concerns:

| | Customer recommendations | Supplier deal suggestions |
|---|---|---|
| **Question answered** | "What should I offer at checkout?" | "What should I go buy today?" |
| **Data source** | Order history per user | kupi.cz deals + delivery history |
| **Key signal** | Purchase frequency + recency + context | Price vs last delivery cost + stock level |
| **Output** | Product IDs to show on shop page | Shopping list grouped by store |
| **Lives in** | SBF (`recommendations` table) | Sidecar (`suggestions` table) |

They could eventually be linked — e.g., a product with high customer demand AND a good deal price
AND low stock is an extremely high-priority restock. But that is a later-phase enrichment, not MVP.

---

## 15. Deployment (Docker Compose)

Add to `docker-compose.yml`:

```yaml
kupi-sidecar:
  image: ghcr.io/your-org/kupi-sidecar:latest
  restart: unless-stopped
  env_file: .env                         # reads same .env as SBF
  environment:
    DATABASE_URL: postgresql://kupi:${KUPI_DB_PASS}@postgres:5432/kupi_sidecar
    SBF_BASE_URL: http://sbf-app:3333    # internal Docker hostname
    KUPI_SHOPS: ${KUPI_SHOPS:-Lidl,Albert,Kaufland,Tesco}
    # KUPI_API_KEY and other vars read from .env directly
  depends_on:
    - postgres
  networks:
    - internal                           # NOT exposed to internet
  # No ports mapping — internal only
```

SBF app needs two additions in `.env`:
```env
KUPI_SIDECAR_URL=http://kupi-sidecar:8000
KUPI_API_KEY=<generate with: openssl rand -hex 32>
KUPI_SHOPS=Lidl,Albert,Kaufland,Tesco
```

---

## 16. Implementation Phases

### Phase 1 — Core sidecar scaffold (MVP)

- [ ] Python project: FastAPI + SQLAlchemy + APScheduler + Alembic + Pydantic BaseSettings
- [ ] `deals` table + daily scrape job (category + KUPI_SHOPS filter)
- [ ] `/health` and `/shop-summary` endpoints (no matching yet — raw deal counts)
- [ ] SBF: catalog endpoint (`GET /api/kupi/catalog` with `lastDeliveryPrice`)
- [ ] SBF: `KupiSidecarService` + simple supplier deals page (shop summary only)

### Phase 2 — Product matching + price signals

- [ ] `product_mappings` + `suggestions` tables
- [ ] Fuzzy matching with rapidfuzz + price signal computation
- [ ] Sidecar: pull catalog on scrape, build suggestions
- [ ] `/suggestions` and `/shopping-list/{shop}` endpoints
- [ ] SBF: `/supplier/deals/shopping-list/:shop` page with price signal badges (buy/consider/skip)
- [ ] SBF: `/supplier/deals/mappings` management page

### Phase 3 — Stock awareness + admin tooling

- [ ] `is_low_stock` flag based on `LOW_STOCK_THRESHOLD`
- [ ] SBF: "Restock now" section on deals page
- [ ] SBF: `/admin/kupi-settings` (category mappings + trigger scrape + scrape status)
- [ ] Low-stock + buy-signal combined alert (email? notification?)

### Phase 4 — MCP server (optional)

- [ ] `fastmcp` integration, `MCP_ENABLED=true` opt-in
- [ ] Tools: `get_shop_ranking`, `get_buy_signals`, `get_low_stock_deals`, `build_shopping_list`
- [ ] Document MCP server URL for Claude Desktop / Claude Code MCP config
- [ ] Consider: cross-signal enrichment (high customer demand + buy signal → priority boost)

---

## 17. Open Questions

1. **Unit size parsing in SBF (Node.js)**: the catalog endpoint needs to parse `unitSizeNormalized`
   and `unitSizeType` from `product.displayName`. Two options: (a) a small TypeScript port of
   `unit_parser.py` regex logic in SBF, or (b) store `unit_size_normalized` + `unit_size_type`
   explicitly on the `products` table (a new migration). Option (b) is cleaner long-term and lets
   suppliers correct the parsed size; option (a) avoids a migration and is sufficient for MVP.

2. **Validity date parsing**: kupi strings like "do 2.4.", "platí od 3.3." — parse to real dates
   (useful for filtering out expired deals before showing the shopping list). Low priority for MVP.

2. **kupi.cz rate limiting**: the library does no backoff. Add configurable `sleep` between
   category+shop requests. Monitor for 429/block responses.

3. **Barcode matching**: `Product.barcode` exists in SBF. kupi.cz does not currently expose
   barcodes, but if it ever does, barcode = direct exact match (no fuzzy needed). Design
   `product_mappings` to support this as a future upgrade path.

4. **Webhook vs polling**: currently SBF polls sidecar on page load (simple). Alternative: sidecar
   posts `POST /api/kupi/webhook` to SBF after each scrape to invalidate a local cache. Only
   needed if the two services run on separate hosts.
