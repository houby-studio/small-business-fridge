# Small Business Fridge — Claude Development Guide

@AGENTS.md

## Mandatory Quality Gates

**BEFORE starting any change, run once to confirm baseline:**

```bash
npm run lint && npx prettier --check . && npm run typecheck && node ace migration:run --force && node ace test --no-color && npm run test:e2e
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
node ace migration:run --force # test DB schema parity
node ace test --no-color # unit + functional (Japa)
npm run test:e2e         # Playwright end-to-end suite
```

> If Docker isn't running: `docker compose -f compose.dev.yaml up -d postgres`
> Tests need PostgreSQL on localhost:5432, database `sbf_test`

**Never leave a task incomplete if any of these fail.** Fix the failure before moving on.

---

## Project Stack

- **Runtime**: AdonisJS 7 (Node.js 22+), ESM modules
- **Database**: PostgreSQL 18 via Lucid ORM
- **Frontend**: Vue 3 + Inertia.js + PrimeVue
- **Auth**: Session-based web + token-based API
- **Lang**: TypeScript throughout (strict mode)
- **Locale**: Czech (cs) primary, English (en) secondary

---

## File Layout (quick reference)

```
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

| Change type                                     | Required tests                                        |
| ----------------------------------------------- | ----------------------------------------------------- |
| New service method                              | Unit test in `tests/unit/services/`                   |
| New API endpoint                                | Functional test in `tests/functional/api/`            |
| New web route / controller action               | Functional test in `tests/functional/web/`            |
| Bug fix                                         | Add regression test proving the bug is fixed          |
| Changed business logic                          | Update existing tests to match new behavior           |
| New migration / model                           | Functional test covering the new data                 |
| UI/UX change (layout/nav/responsive/visibility) | Playwright e2e coverage for the user-visible behavior |

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

- Test DB: `sbf_test` on PostgreSQL port **5432**
- Migrations auto-run before tests, tables truncated after (see `tests/bootstrap.ts`)
- SMTP errors in test output are **normal** — MailDev isn't required for tests to pass
- E2E tests: `npm run test:e2e` (Playwright starts its managed web server via `playwright.config.ts`)
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
// NEVER use v-tooltip (causes runtime errors) — use aria-label instead
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
| `/audit`                  | `['logs', 'filters']`             |
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

- **Docker image**: `.github/workflows/docker-image.yml` — triggers on push to `v3/*` or `master`
- **Quality CI**: `.github/workflows/quality.yml` — runs lint + format + typecheck + tests on every PR and push to `v3/*`
- Dockerfile does NOT run quality checks — they happen in the quality CI job

### Quality CI Reporting (Mandatory)

- Japa tests must generate `test-results/junit-japa.xml` and publish it via `mikepenz/action-junit-report`.
- Playwright tests must generate `test-results/junit-e2e.xml` and publish it via `mikepenz/action-junit-report`.
- CI must verify both XML files exist and are non-empty before publishing.
- CI must upload test artifacts (`test-results/**`, `playwright-report/**`) so failures can be debugged from the run page.
- Do not accept CI changes that can silently report `0 ran` for a suite that actually executed.

---

## UI Component Standards

These rules apply to ALL new Vue pages and components. Never deviate from these patterns.

### PrimeVue Components — Never Use Raw HTML Equivalents

| Need                     | Use           | Never                     |
| ------------------------ | ------------- | ------------------------- |
| Text input               | `InputText`   | `<input type="text">`     |
| Date filter / date field | `DatePicker`  | `<input type="date">`     |
| Password                 | `Password`    | `<input type="password">` |
| Dropdown select          | `Select`      | `<select>`                |
| Multi-select             | `MultiSelect` | —                         |
| Checkbox                 | `Checkbox`    | `<input type="checkbox">` |
| Textarea                 | `Textarea`    | `<textarea>`              |
| Number input             | `InputNumber` | `<input type="number">`   |
| Button                   | `Button`      | `<button>`                |

(Exception: the bespoke touch UI in `inertia/pages/kiosk/*` may use raw elements where the
kiosk interaction model requires it.)

### Buttons — Severity Mapping

Always use these combinations — never invent others:

| Action                                | `severity`       | Variants | `size`  |
| ------------------------------------- | ---------------- | -------- | ------- |
| Primary submit / main CTA             | (none — default) | —        | —       |
| Page-level "Create" / "Add" in header | (none — default) | —        | —       |
| Edit (pencil) icon in table row       | `info`           | `text`   | `small` |
| Delete / trash icon in table row      | `danger`         | `text`   | `small` |
| Archive / warn icon in table row      | `warn`           | `text`   | `small` |
| Approve / positive confirm            | `success`        | —        | —       |
| Destructive confirm (in dialog)       | `danger`         | —        | —       |
| Cancel in dialog footer               | `secondary`      | `text`   | —       |
| Back navigation                       | `secondary`      | `text`   | —       |
| Secondary ghost action                | `secondary`      | `text`   | `small` |

**Never** use the `rounded` prop — it is not part of this design language.

**Icon-only buttons** (no `label`) MUST include `:aria-label`:

<!-- prettier-ignore -->
```html
<!-- ✅ Correct -->
<Button icon="pi pi-pencil" severity="info" text size="small" :aria-label="t('common.edit')" @click="..." />

<!-- ❌ Wrong — no aria-label -->
<Button icon="pi pi-pencil" severity="info" text size="small" @click="..." />
```

**Submit buttons** MUST always have both `:loading` and `:disabled` guards:

<!-- prettier-ignore -->
```html
<Button type="submit" :label="t('common.save')" :disabled="!formValid || submitting" :loading="submitting" />
```

### Form Field Labels

All labels — both form fields and filter inputs — use the same class set:

<!-- prettier-ignore -->
```html
<label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{ t('field.label') }}</label>
```

- No `font-medium` anywhere
- Always `mb-1 block`
- Required fields: append ` *` to the label text (no separate indicator on the input)

### Form Input Validation

Pass `:invalid="!!errorMessage"` on PrimeVue inputs. Show errors with `<small>` below:

```html
<InputText v-model="form.email" :invalid="!!emailError" />
<small v-if="emailError" class="text-red-500 dark:text-red-400">{{ emailError }}</small>
```

### DatePicker — Standard Props

Always use this combination (not just `dateFormat` alone):

```html
<DatePicker
  v-model="..."
  dateFormat="dd.mm.yy"
  :firstDayOfWeek="1"
  showIcon
  :showOnFocus="false"
  class="w-48"
/>
```

### No Native Browser Dialogs — Ever

**Never** call `window.alert`, `window.confirm`, `window.prompt`, or bare `alert(...)` / `confirm(...)` / `prompt(...)` from Vue/Inertia code. They are unstyled, untranslatable, can't be tested with Playwright's normal flow, and break the visual language of the app.

- Confirmation → PrimeVue `Dialog` (see below) with Cancel + Confirm buttons.
- Notifications / transient feedback → `useFlash()` flash messages from the server, or PrimeVue `Toast` / `Message` on the client.
- Input → a proper `Dialog` containing PrimeVue form inputs (never `window.prompt`).

If you catch yourself reaching for `window.confirm`, stop and build a `Dialog` instead — the storno dialog in `inertia/pages/admin/orders/index.vue` is a good reference.

### Dialogs — Two Standard Sizes

Choose based on content, always add `modal :draggable="false"`:

| Size  | Use for                          | Sizing prop                                           |
| ----- | -------------------------------- | ----------------------------------------------------- |
| Small | Single confirm, 1–2 input fields | `:style="{ width: '28rem' }"`                         |
| Large | Multi-field forms                | `style="width: 560px; max-width: calc(100vw - 2rem)"` |

Dialog footer: **Cancel left, Confirm right**:

<!-- prettier-ignore -->
```html
<template #footer>
  <Button :label="t('common.cancel')" severity="secondary" text @click="close" />
  <Button :label="t('common.save')" :disabled="!valid || submitting" :loading="submitting" @click="submit" />
</template>
```

### Tabular Data (DataTable) — Mandatory Rules

Every table-based page MUST have all of the following:

1. **Server-side pagination, filtering, and sorting** — never client-side. Use `@page` / `@sort` → `router.get()` with `only: [...]` partial reload.

2. **Sensible default sort** — always define a default `sortBy` + `sortOrder` in both the service whitelist and the Vue refs. Never leave a table unsorted. Pick the most useful default (e.g., `createdAt desc` for admin logs, `name asc` for catalog lists).

3. **Empty state** via the `#empty` template slot:

```html
<template #empty>
  <div class="py-8 text-center text-gray-500 dark:text-zinc-400">{{ t('common.no_data') }}</div>
</template>
```

4. Always use `stripedRows class="rounded-lg border"` on `<DataTable>`.

### Filter Inputs — FilterBar + "All" Option

Always use the `FilterBar` component for any page with filters — never a custom `div` layout:

<!-- prettier-ignore -->
```html
<FilterBar @apply="applyFilters" @clear="clearFilters">
  <div>
    <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{ t('filter.status') }}</label>
    <Select v-model="filterStatus" :options="statusOptions" optionLabel="label" optionValue="value" class="w-48" />
  </div>
</FilterBar>
```

**Every `Select` used as a filter MUST include an "All" option as the first item and pre-select it by default** (`value: null` → controller treats null/missing as no filter applied):

```typescript
// ✅ Correct
const statusOptions = computed(() => [
  { label: t('common.all'), value: null },
  { label: t('status.active'), value: 'active' },
  { label: t('status.inactive'), value: 'inactive' },
])
const filterStatus = ref(props.filters.status ?? null)
```

### Status Badges / Chips

Use only these color classes — never invent new variants:

| Meaning             | Classes                                                                        |
| ------------------- | ------------------------------------------------------------------------------ |
| Active / Info       | `bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200`             |
| Success / Completed | `bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200`         |
| Warning / Pending   | `bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200`         |
| Danger / Rejected   | `bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300`                 |
| Neutral / Cancelled | `bg-gray-100 text-gray-800 dark:bg-zinc-700 dark:text-zinc-200`                |
| Verified            | `bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200` |

Badge wrapper: `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`

### Page Header Pattern

<!-- prettier-ignore -->
```html
<!-- Simple header -->
<h1 class="mb-6 text-2xl font-bold text-gray-900 dark:text-zinc-100">{{ t('page.title') }}</h1>

<!-- Header with create button -->
<div class="mb-6 flex items-center justify-between">
  <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">{{ t('page.title') }}</h1>
  <Button :label="t('page.create')" icon="pi pi-plus" @click="openCreate" />
</div>
```

Back button (detail pages):

<!-- prettier-ignore -->
```html
<Button icon="pi pi-arrow-left" severity="secondary" text :aria-label="t('common.back')" @click="router.get(...)" />
```

### Default Selections

Always pre-select a sensible default for any `Select` in a data-entry form — never leave a required dropdown blank when there is an obvious choice. Examples:

- Product category field → pre-select the first available category
- Filter dropdowns → always pre-select the "All" option

---

## Common Gotchas

- `@adonisjs/mail` must be **v10+** (v3.x is for old AdonisJS 5)
- PrimeVue themes: use `@primeuix/themes` (not deprecated `@primevue/themes`)
- Login validator field: `username` (not `uid` or `email`)
- Uploads: served via `/uploads/*` route, stored in `storage/uploads/`
- CSRF: API routes are exempted via function in `config/shield.ts`
- Scheduler provider: only registered in console environment (`adonisrc.ts`)
- `v-tooltip` → runtime crash → use `aria-label` or PrimeVue Tooltip component with mount
- `npx prettier --check .` also checks `CLAUDE.md` — always run format fix after editing it
