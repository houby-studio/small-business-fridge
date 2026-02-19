# Small Business Fridge (sbf) — Claude Development Guide

## Mandatory Quality Gates

**BEFORE starting any change, run once to confirm baseline:**

```bash
cd sbf
npm run lint && npx prettier --check . && npm run typecheck && node ace test --no-color
```

**AFTER every change, all of these must pass before finishing:**

```bash
# Shortcut: run everything at once
./check.sh
```

Or individually:

```bash
npm run lint             # ESLint (AdonisJS config)
npx prettier --check .   # Format check (do NOT run npm run format — that auto-writes)
npm run typecheck        # tsc --noEmit
node ace test --no-color # 91 tests: unit + functional (Japa)
```

> If Docker isn't running: `docker compose -f docker-compose.dev.yml up -d postgres`
> Tests need PostgreSQL on localhost:5433, database `sbf_test`

**Never leave a task incomplete if any of these fail.** Fix the failure before moving on.

---

## Project Stack

- **Runtime**: AdonisJS 6 (Node.js 22+), ESM modules
- **Database**: PostgreSQL 17 via Lucid ORM
- **Frontend**: Vue 3 + Inertia.js + PrimeVue (SSR-capable)
- **Auth**: Session-based web + token-based API
- **Lang**: TypeScript throughout (strict mode)
- **Locale**: Czech (cs) primary, English (en) secondary

---

## File Layout (quick reference)

```
sbf/
├── app/
│   ├── controllers/web/          # Inertia controllers (return inertia.render())
│   ├── controllers/web/supplier/ # Supplier section
│   ├── controllers/web/admin/    # Admin section
│   ├── controllers/api/          # REST API (token auth)
│   ├── models/                   # Lucid ORM models
│   ├── services/                 # Business logic (NO HTTP context)
│   ├── validators/               # VineJS validators
│   └── middleware/               # AdonisJS middleware
├── inertia/
│   ├── pages/                    # Vue 3 SFC pages
│   ├── layouts/                  # AppLayout, GuestLayout, KioskLayout
│   └── composables/              # useFlash, useI18n
├── resources/
│   ├── views/emails/             # Edge email templates
│   └── lang/{cs,en}/            # 11 translation files each
├── tests/
│   ├── unit/                     # Pure logic tests (no HTTP)
│   ├── functional/               # HTTP route tests (Japa + AdonisJS plugins)
│   └── e2e/                      # Browser tests (Playwright)
├── config/                       # AdonisJS config files
├── start/                        # routes.ts, kernel.ts, scheduler.ts
├── database/migrations/          # Lucid migrations
└── check.sh                      # Run ALL quality checks at once
```

---

## Test Requirements

### When to Write Tests

| Change type                       | Required tests                               |
| --------------------------------- | -------------------------------------------- |
| New service method                | Unit test in `tests/unit/services/`          |
| New API endpoint                  | Functional test in `tests/functional/api/`   |
| New web route / controller action | Functional test in `tests/functional/web/`   |
| Bug fix                           | Add regression test proving the bug is fixed |
| Changed business logic            | Update existing tests to match new behavior  |
| New migration / model             | Functional test covering the new data        |

### Test Anatomy

**Unit test** (`tests/unit/services/foo_service.spec.ts`):

```typescript
import { test } from '@japa/runner'
import FooService from '#services/foo_service'

test.group('FooService', () => {
  test('does something specific', ({ assert }) => {
    const result = FooService.doThing(input)
    assert.equal(result, expected)
  })
})
```

**Functional test** (`tests/functional/web/foo.spec.ts`):

```typescript
import { test } from '@japa/runner'

test.group('Foo web routes', (group) => {
  group.each.setup(async () => {
    // per-test setup if needed
  })

  test('GET /foo returns 200 for auth user', async ({ client, assert }) => {
    const response = await client.get('/foo').loginAs(user)
    response.assertStatus(200)
  })
})
```

**Run just one test file**:

```bash
node ace test tests/functional/web/shop.spec.ts
```

**Run just unit or functional suite**:

```bash
node ace test --suite=unit
node ace test --suite=functional
```

### Test Infrastructure Notes

- Test DB: `sbf_test` on PostgreSQL port **5433** (shifted from 5432)
- Migrations auto-run before tests, tables truncated after (see `tests/bootstrap.ts`)
- SMTP errors in test output are **normal** — MailDev isn't required for tests to pass
- E2E tests: `npm run test:e2e` (requires server to start separately, uses Playwright)
- Rate limiter store must be cleared between tests if testing rate-limited routes

### Test Users (seeded via E2E global setup, NOT available in unit/functional)

For functional tests, create users inline with the factory pattern or use `loginAs`:

```typescript
const user = await User.create({ username: 'test', ... })
const response = await client.get('/orders').loginAs(user)
```

---

## Code Conventions

### AdonisJS Patterns

```typescript
// Auth — always use verifyCredentials + login, never attempt()
const user = await User.verifyCredentials(username, password)
await auth.use('web').login(user)

// Relations — always use callback form for nested loads
await user.load((loader) => loader.load('orders'))

// Role check — role middleware handles this, but in code:
// admin implicitly has supplier access (check middleware/role.ts)

// Method spoofing for DELETE/PUT in HTML forms:
// <input type="hidden" name="_method" value="DELETE">
```

### Vue / Inertia Patterns

```typescript
// NEVER use v-tooltip (causes SSR errors) — use aria-label instead
// Images served from /uploads/* route
// useI18n() for translations — simple {param} substitution
// useFlash() for flash messages from controllers
```

### Inertia Partial Reloads (MANDATORY for pagination / filter / sort)

Every `router.get()` call that only changes paginated data **must** include `only: [...]` to
prevent translations and other shared data from being re-sent on every navigation.

**Rule:** list only the props that actually change — the page data prop and `filters`.
Props not listed keep their previous values on the client (Inertia merges).

```typescript
// ✅ Correct — partial reload, translations NOT re-sent
router.get('/orders', { ...params, page: 2 }, { preserveState: true, only: ['orders', 'filters'] })

// ❌ Wrong — full shared data (translations, locale, user) re-sent every time
router.get('/orders', { ...params, page: 2 }, { preserveState: true })
```

**Shared data behaviour** (defined in `config/inertia.ts`):

| Prop           | Wrapper            | Sent on partial reload? |
| -------------- | ------------------ | ----------------------- |
| `user`         | `inertia.always()` | Yes — always            |
| `flash`        | `inertia.always()` | Yes — always            |
| `locale`       | plain function     | No — excluded by `only` |
| `translations` | plain function     | No — excluded by `only` |

**Per-page `only` values** (reference for existing pages):

| Page                      | `only` props                      |
| ------------------------- | --------------------------------- |
| `/orders`                 | `['orders', 'filters']`           |
| `/invoices`               | `['invoices', 'filters']`         |
| `/admin/orders`           | `['orders', 'filters']`           |
| `/admin/invoices`         | `['invoices', 'filters']`         |
| `/admin/users`            | `['users', 'filters']`            |
| `/admin/audit`            | `['logs', 'filters']`             |
| `/audit`                  | `['logs']`                        |
| `/supplier/payments`      | `['invoices', 'filters']`         |
| `/supplier/deliveries`    | `['recentDeliveries', 'filters']` |
| `/supplier/products`      | `['products', 'filters']`         |
| `/shop` (category filter) | `['products', 'filters']`         |

**Server-side sorting pattern** (for new paginated service methods):

```typescript
// Service — whitelist sort fields, default to 'createdAt' desc
const sortByWhitelist = ['createdAt', 'totalCost']
const sortBy = sortByWhitelist.includes(filters?.sortBy ?? '') ? filters!.sortBy! : 'createdAt'
const sortOrder = filters?.sortOrder === 'asc' ? 'asc' : 'desc'
query.orderBy(sortBy, sortOrder)
```

```typescript
// Vue — wire up PrimeVue DataTable lazy sort
const filterSortBy = ref(props.filters.sortBy || 'createdAt')
const filterSortOrder = ref(props.filters.sortOrder || 'desc')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

function onSort(event: any) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  router.get(
    '/path',
    {
      ...buildFilterParams(),
      sortBy: event.sortField,
      sortOrder: event.sortOrder === 1 ? 'asc' : 'desc',
      page: 1,
    },
    { preserveState: true, only: ['data', 'filters'] }
  )
}
// DataTable: :sortField="filterSortBy" :sortOrder="sortOrderNum" @sort="onSort"
// Column:    field="createdAt" sortable
```

### TypeScript

- Avoid `any` — use proper types or `unknown`
- Service classes should have no HTTP context dependencies
- Controllers should be thin — delegate to services
- Validators live in `app/validators/` as VineJS schemas

---

## Translation Rules

When adding user-facing text:

1. Add key to **both** `resources/lang/cs/` and `resources/lang/en/` in the relevant file
2. Use the `useI18n()` composable in Vue: `{{ t('shop.addToCart') }}`
3. 11 files per locale: `messages, common, auth, shop, orders, invoices, supplier, admin, kiosk, emails, profile`
4. Email templates use Edge i18n helpers

---

## CI/CD

- **Docker image**: `.github/workflows/sbf-docker-image.yml` — triggers on push to `v3/*` or `master` when `sbf/**` changes
- **Quality CI**: `.github/workflows/sbf-quality.yml` — runs lint + format + typecheck + tests on every PR and push to `v3/*`
- Dockerfile does NOT run quality checks — they happen in the quality CI job

---

## Common Gotchas

- `@adonisjs/mail` must be **v9+** (v3.x is for old AdonisJS 5)
- PrimeVue themes: use `@primeuix/themes` (not deprecated `@primevue/themes`)
- Login validator field: `username` (not `uid` or `email`)
- Uploads: served via `/uploads/*` route, stored in `storage/uploads/`
- CSRF: API routes are exempted via function in `config/shield.ts`
- Scheduler provider: only registered in console environment (`adonisrc.ts`)
- `v-tooltip` → SSR crash → use `aria-label` or PrimeVue Tooltip component with mount
