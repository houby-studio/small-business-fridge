# Small Business Fridge — Testing Reference

Complete guide to the test suite for the `sbf/` AdonisJS application.
Use this when writing new tests, running existing ones, or debugging failures.

---

## Overview

There are **three distinct test tiers**, each with different runners, database targets, and
purposes. They must never be confused — especially regarding which database they use.

| Tier           | Runner                 | DB used    | Command                            | Wipes DB?                  |
| -------------- | ---------------------- | ---------- | ---------------------------------- | -------------------------- |
| **Unit**       | Japa (`node ace test`) | `sbf_test` | `node ace test --suite=unit`       | Per test (manual `DELETE`) |
| **Functional** | Japa (`node ace test`) | `sbf_test` | `node ace test --suite=functional` | Per test (manual `DELETE`) |
| **E2E**        | Playwright             | `sbf_test` | `npm run test:e2e`                 | Once in global setup       |

> **CRITICAL**: All test tiers use the **`sbf_test` database**, never `sbf` (dev). Both databases
> live in the same PostgreSQL container on port **5433**. The safety boundary is the database
> **name**, not the port.

---

## Database Safety

### Setup

One PostgreSQL 17 container runs on host port **5433** (maps to container port 5432 internally).
It contains two databases:

```
postgresql://sbf:sbf@localhost:5433/sbf       ← dev database (your live data)
postgresql://sbf:sbf@localhost:5433/sbf_test  ← test database (wiped by tests)
```

Both the Japa tests (`.env.test`) and Playwright E2E (`playwright.config.ts` webServer env and
`global_setup.ts`) hardcode `DB_DATABASE=sbf_test`. There is no way for a correctly-invoked test
command to touch the dev database — they use different database names on the same server.

### Before running any tests

PostgreSQL must be running. Start it with:

```bash
cd sbf/
docker compose -f docker-compose.dev.yml up -d postgres
```

The test database `sbf_test` is created automatically by the Docker compose setup alongside the
dev database.

---

## Tier 1: Unit Tests

**Runner**: Japa
**Location**: `tests/unit/**/*.spec.ts`
**Suite name**: `unit`
**Timeout**: 2000 ms per test

### What they test

Pure business logic in service classes and helper utilities. No HTTP requests, no session state.
They do hit the test database (via Lucid ORM factories), but they manage their own cleanup.

### How to run

```bash
# All unit tests
node ace test --suite=unit

# Single file
node ace test tests/unit/services/shop_service.spec.ts
```

### Database lifecycle

- **Migration**: runs **once** at the start of the full `node ace test` run (via
  `runnerHooks.setup` in `tests/bootstrap.ts` — `testUtils.db().migrate()`).
- **Cleanup**: each `test.group` uses `group.each.setup(async () => { ... DELETE ... })` to
  manually `DELETE` from all affected tables before every individual test. Some groups also add a
  `group.each.teardown` for the same reason.
- **No automatic truncate between tests** — cleanup is explicit and per-group.
- After the full test run, `runnerHooks.teardown` runs `testUtils.db().truncate()` which wipes all
  tables (this runs after both unit + functional are done).

### Existing unit test files

#### `tests/unit/helpers/image_url.spec.ts`

Tests the `normalizeImagePath()` helper. Fully pure (no DB). Covers:

- `null`, `undefined`, empty string → `null`
- Legacy `./images/` paths → rewritten to `/uploads/products/`
- Old placeholder paths (`/images/default-product.png`, `preview.png`) → `null`
- Valid `/uploads/products/` paths pass through unchanged

#### `tests/unit/services/shop_service.spec.ts`

Tests `ShopService` against the test DB using Lucid factories. Covers:

- `getProducts()` returns only in-stock products
- `getProducts()` excludes out-of-stock by default; includes them when `showAll: true`
- Products in disabled categories are excluded
- Cheapest delivery price wins when multiple deliveries exist
- Favorites are marked for authenticated users
- `getCategories()` returns only active (non-disabled) categories

**Cleanup**: deletes `user_favorites`, `orders`, `deliveries`, `products`, `categories`, `users`
before each test.

#### `tests/unit/services/order_service.spec.ts`

Tests `OrderService` against the test DB. Covers:

- `purchase()` creates an Order record and decrements `delivery.amountLeft`
- Purchase channel is stored (`web`, `kiosk`, `scanner`)
- Throws `OUT_OF_STOCK` when `amountLeft === 0`
- Throws `OUT_OF_STOCK` for non-existent delivery ID
- Sequential purchases decrement correctly; 4th purchase on stock-3 throws
- `getOrdersForUser()` returns paginated orders with correct stats

**Cleanup**: deletes `orders`, `deliveries`, `products`, `categories`, `users` before each test.

#### `tests/unit/services/invoice_service.spec.ts`

Tests `InvoiceService` across 5 groups. Covers:

- **generateInvoices**: one invoice per buyer, separate invoices per buyer, links orders to invoice,
  returns empty when no uninvoiced orders, skips already-invoiced orders, self-invoice auto-paid
- **requestPayment / cancelPaymentRequest**: buyer can request/cancel, throws `FORBIDDEN` for wrong
  buyer, throws `ALREADY_PAID` for paid invoice
- **approvePayment / rejectPayment**: supplier can approve/reject, throws `FORBIDDEN` for wrong
  supplier
- **getInvoicesForBuyer status filter**: filters `paid`, `unpaid`, `awaiting`; no filter returns all
- **getUninvoicedSummary**: returns buyers with totals, excludes already-invoiced

**Cleanup**: deletes all tables (full `cleanAll()` helper) before **and** after each test.

---

## Tier 2: Functional Tests

**Runner**: Japa
**Location**: `tests/functional/**/*.spec.ts`
**Suite name**: `functional`
**Timeout**: 30000 ms per test

### What they test

Full HTTP request/response cycle. Tests send real HTTP requests to the AdonisJS app (started in
memory) and assert on status codes, redirect locations, and database state changes. Uses Japa's
`client` fixture (from `@japa/api-client` + `pluginAdonisJS`).

### How to run

```bash
# All functional tests
node ace test --suite=functional

# Single file
node ace test tests/functional/web/shop.spec.ts

# All tests (unit + functional together)
node ace test --no-color
```

### Database lifecycle

Same as unit tests — shared runner hooks do migration once at start and truncate once at end.
Individual test groups use `group.each.setup(cleanAll)` and `group.each.teardown(cleanAll)` where
`cleanAll` manually deletes all tables in dependency order.

### HTTP server

`tests/bootstrap.ts` configures `configureSuite` to call `testUtils.httpServer().start()` for
the `functional` suite. The server runs in-process at `localhost:3334`.

### Session + auth in tests

The Japa bootstrap registers `sessionApiClient`, `authApiClient`, and `shieldApiClient` plugins.
This enables:

```typescript
// Log in as a specific user (session auth)
await client.get('/shop').loginAs(user)

// Include a valid CSRF token
await client.post('/shop/purchase').withCsrfToken().json({ deliveryId: 1 })

// API token auth (for API endpoints)
const token = await User.accessTokens.create(user, ['*'])
await client.get('/api/v1/products').header('Authorization', `Bearer ${token.value!.release()}`)
```

### Existing functional test files

#### `tests/functional/web/auth.spec.ts`

- Login page renders for guests (200)
- Unauthenticated redirect from `/shop` (302)
- Authenticated access to `/shop`, `/orders`, `/invoices`, `/profile` (200)
- Role middleware: customer blocked from `/supplier/stock` and `/admin/dashboard`
- Supplier can access `/supplier/stock`
- Admin can access `/admin/dashboard`
- Admin has implicit supplier access (`/supplier/stock` → 200)

#### `tests/functional/web/shop.spec.ts`

- Shop page renders for authenticated user; redirects unauthenticated
- Products from active categories appear in response body
- Shop loads with no products
- Category filter param (`?category=ID`) — server returns all products (filtering is client-side)
- No category filter returns all in-stock products
- Purchase: successful → redirect to `/shop`, stock decremented, order created with `channel=web`
- Purchase out-of-stock: redirect to `/shop`, no order created
- Purchase requires authentication
- Purchase with invalid `deliveryId` → redirect (web validation, not 422)
- Multiple purchases correctly track orders per buyer
- `?add_favorite=ID` adds product to favorites and redirects
- Duplicate favorite does not create a second row
- Non-existent product ID in `add_favorite` redirects gracefully

#### `tests/functional/web/invoices.spec.ts`

- Invoices page renders for authenticated user; redirects unauthenticated
- Buyer can request payment on their invoice (`/invoices/:id/request-paid`)
- Buyer cannot request payment on another buyer's invoice → redirect, no state change
- Request on already-paid invoice redirects with info, stays paid
- Requires authentication for all mutations
- Status filter `?status=paid|unpaid|awaiting` → 200
- Buyer can cancel payment request (`/invoices/:id/cancel-paid`)
- Buyer cannot cancel another buyer's request → redirect, state unchanged

#### `tests/functional/web/supplier.spec.ts`

- Supplier stock page accessible to supplier; customer blocked
- Stock page with `?name=`, `?inStock=1`, `?sortBy=totalRemaining&sortOrder=asc` → 200
- Supplier invoice page accessible; customer blocked
- Invoice generate: creates invoices for uninvoiced orders, correct `totalCost`
- Generate with no uninvoiced orders → redirect, no invoice created
- Admin can also generate invoices (implicit supplier access)
- Payments filter `?status=awaiting|paid` → 200
- Supplier can approve a payment request → invoice `isPaid=true`
- Supplier can reject a payment request → `isPaid=false`, `isPaymentRequested=false`
- Supplier cannot approve another supplier's invoice → no state change
- Customer cannot access payment actions → role redirect (302)
- Invalid `action` field → redirect, no state change

#### `tests/functional/web/admin.spec.ts`

- Admin users page accessible; customer blocked
- User search `?search=`, role filter `?role=`, combined → 200
- Admin orders page; filter by `?channel=web`, `?invoiced=no`, `?search=` → 200
- Admin invoices page; filter by `?status=paid|unpaid|awaiting` → 200

#### `tests/functional/web/profile.spec.ts`

- `POST /profile/color-mode` saves `dark` or `light`, verifies DB update
- Invalid value (`auto`) → redirect, DB unchanged
- Requires authentication

#### `tests/functional/api/health.spec.ts`

- `GET /api/v1/health` → 200 with `{ status: "ok", timestamp, uptime, checks.database }`
- Response includes `x-ratelimit-limit` and `x-ratelimit-remaining` headers

**Note**: clears the rate limiter `throttleStore` before each test (in-memory map must be reset to
avoid cross-test bleed).

#### `tests/functional/api/auth.spec.ts`

- Token auth: `POST /api/v1/auth/token` with valid credentials → 200, token + user in body
- Wrong password → 401
- Disabled user → 401
- Keypad login: `POST /api/v1/auth/login` with `keypadId` + correct `apiSecret` → 200, token
- Wrong API secret → 401
- Non-existent keypadId → 401

#### `tests/functional/api/products.spec.ts`

- Unauthenticated `GET /api/v1/products` → 401
- Authenticated with bearer token → 200, array of products
- `GET /api/v1/products/:barcode` → 200 with product and `stockSum`
- Non-existent barcode → 404

---

## Tier 3: E2E Tests

**Runner**: Playwright
**Location**: `tests/e2e/**/*.spec.ts`
**Browser**: Microsoft Edge (`msedge`, `/usr/bin/microsoft-edge-stable`)
**Workers**: 1 (serial, no parallelism — avoids DB conflicts)

### What they test

Full browser automation. A real AdonisJS server starts before the suite and Playwright controls
a browser against it. These tests verify UI rendering, navigation, and role-based access as a
real user would experience it.

### How to run

```bash
# All E2E tests
npm run test:e2e
# (equivalent to: npx playwright test)

# With UI (interactive)
npx playwright test --ui

# Single file
npx playwright test tests/e2e/auth.spec.ts

# With headed browser (visible)
npx playwright test --headed
```

### Server startup

`playwright.config.ts` uses `webServer` to auto-start the app:

```
command: node ace serve --no-hmr
url:     http://localhost:3334
```

In CI (`process.env.CI` set), a fresh server is always started. Locally (`reuseExistingServer: true`),
Playwright reuses an already-running server on port 3334 if one exists.

### Global setup (`tests/e2e/global_setup.ts`)

This runs **once** before any E2E test, directly via a raw `pg` client connected to `sbf_test`:

1. **Runs migrations** via `execSync('node ace migration:run --force', { env: TEST_ENV })`
2. **Hashes passwords** using AdonisJS's own Scrypt driver (same config as production)
3. **Upserts 5 users**:
   - `admin / admin123` — role `admin`
   - `supplier / supplier123` — role `supplier`
   - `customer / customer123` — role `customer`
   - `customer2 / customer123` — role `customer` (second buyer for supplier view diversity)
   - `kiosk / kiosk123` — role `customer`, keypadId 89993
4. **Upserts 4 categories**: Nealko (6 products), Alko (3), Sladkosti (3), Jídlo (3)
5. **Upserts 15 products** (keypadIds 1–15) across all categories
6. **Resets and creates deliveries** with 50 stock each
7. **Seeds 33 orders** across two customers, spread over 30 days, across all purchase channels
8. **Seeds 3 invoices** in all three states:
   - Invoice 1 (orders 1–10, customer) — **PAID**
   - Invoice 2 (orders 11–20, customer) — **payment requested** (awaiting approval)
   - Invoice 3 (orders 26–33, customer2) — **unpaid** (no request yet)
   - Orders 21–25 (customer) remain uninvoiced

All upserts use `ON CONFLICT ... DO UPDATE` so repeated runs are idempotent.

### Locale

Playwright is configured with `locale: 'cs-CZ'` so the UI renders in Czech. Tests use Czech text
for assertions (e.g., `'Vše'`, `'Koupit'`).

### No automatic teardown

E2E tests do **not** clean up after themselves. The global setup is designed to be idempotent
(upserts, not inserts), so re-running is always safe.

### Existing E2E test files

#### `tests/e2e/auth.spec.ts`

- Login page shows form with `#username`, `#password`, submit button
- Unauthenticated `/` shows sign-in link (not a redirect)
- Unauthenticated `/shop` redirects to `/login`
- Invalid credentials stays on `/login` and shows a `[role="alert"]` toast
- Customer logs in → redirected to `/shop`
- Admin logs in → not on `/login`
- Supplier logs in → not on `/login`
- Logged-in customer can log out via `.pi-sign-out` icon button → redirected to `/login`

#### `tests/e2e/shop.spec.ts`

- Unauthenticated user redirected from `/shop` to `/login`
- Customer can view shop page (`h1` visible)
- Category filter buttons present (`'Vše'` button)
- Product cards with `'Koupit'` button visible
- No browser console errors on shop page
- Supplier can access `/supplier/invoice`
- Customer redirected away from `/supplier/invoice`
- Admin can access `/admin/dashboard`
- Customer redirected away from `/admin/dashboard`
- Customer can navigate to `/invoices` and `/orders` (with `h1` visible)

---

## Factories

All factories live in `database/factories/` and use `@adonisjs/lucid/factories`.
They insert directly into the test DB. Use `.merge({})` to override specific fields,
`.apply('stateName')` to apply predefined states, `.with('relation')` to create related records.

### UserFactory

```typescript
UserFactory.create() // role: 'customer'
UserFactory.apply('supplier').create() // role: 'supplier'
UserFactory.apply('admin').create() // role: 'admin'
UserFactory.apply('kiosk').create() // isKiosk: true
UserFactory.apply('disabled').create() // isDisabled: true
UserFactory.apply('withIban').create() // random CZ IBAN
UserFactory.merge({ username: 'alice', password: 'pass123' }).create()
```

Defaults: random `displayName`, `email`, `username`; password `'password123'`; `keypadId`
auto-increments from 100; `colorMode: 'dark'`.

> **Note**: Passwords in factories are stored as **plain text** and AdonisJS hashes them
> transparently on first save via the model hook.

### CategoryFactory

```typescript
CategoryFactory.create() // isDisabled: false
CategoryFactory.apply('disabled').create()
```

Name includes an auto-incrementing suffix to avoid unique constraint violations.

### ProductFactory

```typescript
ProductFactory.create() // needs an existing category
ProductFactory.merge({ categoryId: cat.id }).create()
ProductFactory.with('category').create() // creates category inline
```

`keypadId` auto-increments from 1.

### DeliveryFactory

```typescript
DeliveryFactory.create() // random amount (5–30), random price
DeliveryFactory.apply('depleted').create() // amountLeft: 0
DeliveryFactory.apply('partiallyDepleted').create()
DeliveryFactory.with('supplier', 1, (s) => s.apply('supplier'))
  .with('product', 1, (p) => p.with('category'))
  .merge({ amountLeft: 5, price: 25 })
  .create()
```

### OrderFactory

```typescript
OrderFactory.create() // channel: 'web'
OrderFactory.apply('kiosk').create()
OrderFactory.apply('scanner').create()
OrderFactory.merge({ buyerId: user.id, deliveryId: delivery.id }).create()
```

### InvoiceFactory

```typescript
InvoiceFactory.create() // isPaid: false, isPaymentRequested: false
InvoiceFactory.apply('paid').create() // isPaid: true, isPaymentRequested: true
InvoiceFactory.apply('paymentRequested').create() // isPaymentRequested: true, isPaid: false
InvoiceFactory.merge({ buyerId: buyer.id, supplierId: supplier.id }).create()
```

---

## Environment Configuration

### `.env.test` (used by Japa unit/functional tests)

```env
NODE_ENV=test
PORT=3334
DB_HOST=127.0.0.1
DB_PORT=5433
DB_DATABASE=sbf_test
SESSION_DRIVER=memory    # ← in-memory sessions, no Redis needed
OIDC_ENABLED=false
API_SECRET=test-api-secret
APP_KEY=test-app-key-for-testing-only-123
```

AdonisJS loads `.env.test` automatically when `NODE_ENV=test`, which `bin/test.ts` sets before
anything else imports. No manual env setup needed.

### Playwright env (inline in `playwright.config.ts`)

Same values, but injected into the `webServer` process via the `env` key. Not loaded from
`.env.test` — Playwright manages its own process environment.

---

## Running All Quality Checks

```bash
cd sbf/
./check.sh
```

This runs all 4 gates in order, stopping on first failure:

1. `npm run lint` — ESLint
2. `npx prettier --check .` — Prettier format check (read-only, does NOT write)
3. `npm run typecheck` — `tsc --noEmit`
4. `node ace test --no-color` — unit + functional (91 tests)

Skip tests (e.g. to just check linting quickly):

```bash
./check.sh --skip-tests
```

E2E tests are **not** included in `./check.sh`. Run them separately when needed.

---

## Common Patterns and Pitfalls

### Cleanup order matters

Delete in reverse dependency order to avoid FK violations:

```typescript
const cleanAll = async () => {
  await db.from('audit_logs').delete()
  await db.from('user_favorites').delete()
  await db.from('orders').delete() // references invoices, deliveries
  await db.from('invoices').delete() // references users
  await db.from('deliveries').delete() // references products, users
  await db.from('products').delete() // references categories
  await db.from('categories').delete()
  await db.from('auth_access_tokens').delete()
  await db.from('users').delete()
}
```

Simpler test groups that only use a subset of tables only need to delete those tables.

### Rate limiter bleed between API tests

The rate limiter is an in-memory `Map`. Import and clear it in `group.each.setup`:

```typescript
import { store as throttleStore } from '#middleware/throttle_middleware'

group.each.setup(async () => {
  throttleStore.clear()
  // ... DB cleanup
})
```

### CSRF tokens in POST requests

Web routes require CSRF. In functional tests:

```typescript
await client.post('/shop/purchase').withCsrfToken().json({ deliveryId: id }).loginAs(user)
```

API routes are exempted from CSRF (see `config/shield.ts`).

### SMTP errors are expected

Tests may print SMTP connection errors — this is normal. MailDev is not required for unit or
functional tests. Email sending is attempted but the failure is caught and the test still passes.

### Redirect assertions

Web mutation routes (POST) redirect on success and on most errors. To inspect the redirect
without following it:

```typescript
const response = await client
  .post('/invoices/1/request-paid')
  .loginAs(user)
  .withCsrfToken()
  .redirects(0)
response.assertStatus(302)
assert.equal(response.header('location'), '/invoices')
```

### Web validation failures return 302, not 422

Unlike API routes that return 422 on validation error, web (Inertia) routes redirect back with
session errors. Tests for invalid input should check `assertStatus(302)` or check that the
state was not mutated.

---

## Test Output / CI Reports

Both Japa and Playwright write **JUnit XML** files to `test-results/` after every run.

| File                          | Contents                           |
| ----------------------------- | ---------------------------------- |
| `test-results/junit-japa.xml` | All unit + functional test results |
| `test-results/junit-e2e.xml`  | All Playwright E2E results         |

These files are consumed by `mikepenz/action-junit-report@v4` in the GitHub Actions workflow
(`.github/workflows/sbf-quality.yml`). After each push/PR the action posts:

- A **Check Run** on the commit with pass/fail counts
- **Inline annotations** on failing test lines in the diff view
- A **job summary** table listing all suites and their pass/fail counts

The `checks: write` and `pull-requests: write` permissions are set on the quality job to enable
these annotations.

For **Azure DevOps** the same JUnit XML files work natively with the "Publish Test Results" task:

```yaml
- task: PublishTestResults@2
  inputs:
    testResultsFormat: JUnit
    testResultsFiles: 'sbf/test-results/junit-*.xml'
    mergeTestResults: true
    testRunTitle: 'SBF Tests'
```

---

## Test Counts (current)

| Suite          | Tests           |
| -------------- | --------------- |
| Unit           | 44              |
| Functional     | 83              |
| **Japa total** | **127**         |
| E2E            | 19 (Playwright) |

---

## Adding New Tests

| What changed            | Where to add tests                              |
| ----------------------- | ----------------------------------------------- |
| New service method      | `tests/unit/services/<service>.spec.ts`         |
| New API endpoint        | `tests/functional/api/<resource>.spec.ts`       |
| New web route           | `tests/functional/web/<section>.spec.ts`        |
| Bug fix                 | Add a regression test in the relevant spec file |
| UI interaction / visual | `tests/e2e/<feature>.spec.ts`                   |

Always add the new `cleanAll` setup/teardown to any new test group that touches the DB.
