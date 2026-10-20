<script setup lang="ts">
import { hasActiveFilters } from '~/composables/use_filter_params'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Head, Link, router, usePage } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Column from 'primevue/column'
import ConfirmDialog from 'primevue/confirmdialog'
import InputNumber from '~/components/NumberInput.vue'
import Select from 'primevue/select'
import Textarea from 'primevue/textarea'
import FilterBar from '~/components/FilterBar.vue'
import InfoHint from '~/components/InfoHint.vue'
import PageTabs from '~/components/PageTabs.vue'
import PaginatedDataTable from '~/components/PaginatedDataTable.vue'
import { useI18n } from '~/composables/use_i18n'
import { useAppConfirm } from '~/composables/use_app_confirm'
import { useMoney } from '~/composables/use_pricing'
import { formatDate } from '~/composables/use_format_date'
import type { SharedProps } from '~/types'
import { createServerClock } from '~/composables/use_server_clock'
import { ADJUSTMENT_NOTE_MAX, INVENTORY_MAX_COUNT } from '~/composables/use_shopping_validation'

interface CountableProduct {
  productId: number
  productName: string
  imagePath: string | null
  categoryName: string | null
  categoryColor: string | null
  stock: number
}

type InventoryScope = 'mine' | 'all'
type CountsWho = 'mine' | 'all'

interface CountRow {
  id: number
  createdAt: string
  actorName: string
  scope: InventoryScope
  note: string | null
  products: number
  lossQuantity: number
  surplusQuantity: number
  lossValue: number
  lossCost: number
}

const props = defineProps<{
  products: CountableProduct[]
  /** When the server read `products[].stock` (ISO). */
  stockAsOf: string
  categories: Array<{ id: number; name: string; color: string }>
  counts: {
    data: CountRow[]
    meta: { total: number; perPage: number; currentPage: number; lastPage: number }
  }
  filters: { scope: InventoryScope; categoryId: string; who: CountsWho }
}>()

const { t, tp } = useI18n()
const { money } = useMoney()
const confirm = useAppConfirm()

const tabs = computed(() => [
  { label: t('common.tab_stock_state'), url: '/supplier/stock', testId: 'tab-stock-state' },
  {
    label: t('common.tab_stock_history'),
    url: '/supplier/deliveries',
    testId: 'tab-stock-history',
  },
  { label: t('common.tab_inventory'), url: '/supplier/inventory', testId: 'tab-inventory' },
])

// ─── Sheet filters (what gets counted) ─────────────────────────────────────────
const ALL = '__all__'
const filterScope = ref<InventoryScope>(props.filters.scope === 'mine' ? 'mine' : 'all')
const filterCategoryId = ref(props.filters.categoryId || ALL)
const filterWho = ref<CountsWho>(props.filters.who === 'all' ? 'all' : 'mine')
const scopeOptions = computed(() => [
  { label: t('common.scope_all'), value: 'all' },
  { label: t('common.scope_mine'), value: 'mine' },
])
const categoryOptions = computed(() => [
  { label: t('common.all'), value: ALL },
  ...props.categories.map((c) => ({ label: c.name, value: String(c.id) })),
])
const whoOptions = computed(() => [
  { label: t('inventory.who_all'), value: 'all' },
  { label: t('inventory.who_mine'), value: 'mine' },
])

function buildParams() {
  return {
    scope: filterScope.value === 'all' ? undefined : filterScope.value,
    categoryId: filterCategoryId.value === ALL ? undefined : filterCategoryId.value,
    who: filterWho.value === 'mine' ? undefined : filterWho.value,
  }
}

// "Kdo" filters the history table below, not the sheet — it never shows "Clear".
const filtersActive = computed(() => hasActiveFilters(buildParams(), ['who']))

function applyFilters() {
  router.get('/supplier/inventory', buildParams(), {
    preserveState: true,
    only: ['products', 'filters'],
  })
}

function clearFilters() {
  filterScope.value = 'all'
  filterCategoryId.value = ALL
  applyFilters()
}

// ─── Past inventories (below the sheet; partial reload only) ──────────────────
function reloadCounts(page: number) {
  router.get(
    '/supplier/inventory',
    { ...buildParams(), page },
    { preserveState: true, preserveScroll: true, only: ['counts', 'filters'] }
  )
}

function onCountsPage(event: { page: number }) {
  reloadCounts(event.page + 1)
}

function onWhoChange() {
  reloadCounts(1)
}

// ─── The sheet ─────────────────────────────────────────────────────────────────
// Everything counted stays counted across filters and reloads: a product counted under
// one category is still sent when another category is shown. Per product the stock the
// counter compared with, and when the sheet read it (`asOf`), go along — the server moves
// that stock on by what was sold or stocked before the product was counted.
interface CountedEntry {
  name: string
  counted: number
  expected: number
  asOf: string
  countedAt: string
}
const counted = reactive<Record<number, CountedEntry>>({})
const note = ref('')
const submitting = ref(false)

// The server's clock, not the phone's: `countedAt` is compared with order timestamps.
// Synced when `stockAsOf` arrives (page load and every refresh), not lazily on first use.
const serverClock = createServerClock()
watch(
  () => props.stockAsOf,
  (stockAsOf) => serverClock.sync(stockAsOf),
  { immediate: true }
)

function setCounted(product: CountableProduct, value: number | null) {
  if (value === null) {
    delete counted[product.productId]
    return
  }
  const previous = counted[product.productId]
  counted[product.productId] = {
    name: product.productName,
    // The field has no max (CLAUDE.md › Number fields); the server bound is applied here.
    counted: Math.min(value, INVENTORY_MAX_COUNT),
    // Correcting a number keeps the moment it was first counted against.
    expected: previous?.expected ?? product.stock,
    asOf: previous?.asOf ?? props.stockAsOf,
    countedAt: previous?.countedAt ?? serverClock.now(),
  }
}

function markMatches(product: CountableProduct) {
  delete counted[product.productId]
  setCounted(product, product.stock)
}

function difference(product: CountableProduct): number | null {
  const entry = counted[product.productId]
  return entry ? entry.counted - entry.expected : null
}

/** "−2" with a real minus sign, "+1", or "—" when not counted. */
function formatDiff(diff: number | null) {
  if (diff === null) return '—'
  if (diff > 0) return `+${diff}`
  return diff < 0 ? `\u2212${-diff}` : '0'
}

const entries = computed(() =>
  Object.entries(counted).map(([productId, entry]) => ({
    productId: Number(productId),
    expected: entry.expected,
    counted: entry.counted,
    asOf: entry.asOf,
    countedAt: entry.countedAt,
  }))
)
const countedOutsideFilter = computed(() => {
  const shown = new Set(props.products.map((p) => p.productId))
  return entries.value.filter((entry) => !shown.has(entry.productId)).length
})
const summary = computed(() => {
  let missing = 0
  let extra = 0
  for (const entry of entries.value) {
    const diff = entry.counted - entry.expected
    if (diff < 0) missing += -diff
    else extra += diff
  }
  return { products: entries.value.length, missing, extra }
})

function clearSheet() {
  for (const key of Object.keys(counted)) delete counted[Number(key)]
  note.value = ''
  storage.remove()
}

function submit() {
  if (submitting.value || entries.value.length === 0) return
  confirm.require({
    header: t('inventory.commit_title'),
    message: t('inventory.commit_message', {
      missing: summary.value.missing,
      extra: summary.value.extra,
    }),
    acceptLabel: t('inventory.commit'),
    rejectLabel: t('common.cancel'),
    accept: () => {
      submitting.value = true
      router.post(
        '/supplier/inventory',
        {
          // The sheet shows the applied scope, not an unapplied change in the filter bar.
          scope: props.filters.scope,
          ...(note.value.trim() ? { note: note.value.trim() } : {}),
          items: entries.value,
        },
        {
          onSuccess: (page) => {
            // A failed commit comes back to this page; a saved one goes to its detail.
            if (page.component !== 'supplier/inventory/index') clearSheet()
          },
          onFinish: () => {
            submitting.value = false
          },
        }
      )
    },
  })
}

// ─── Keyboard: Enter moves to the next product ─────────────────────────────────
function focusNext(productId: number) {
  const index = props.products.findIndex((p) => p.productId === productId)
  const next = props.products[index + 1]
  const target = next
    ? document.getElementById(`inventory-counted-${next.productId}`)
    : document.querySelector<HTMLElement>('[data-testid="inventory-commit"]')
  target?.focus()
  if (target instanceof HTMLInputElement) target.select()
}

// ─── Keeping the work: session storage, leave guard, fresh stock ──────────────
const page = usePage<SharedProps>()
const storage = {
  key: () => `inventory-sheet:${page.props.user?.id ?? 'anon'}`,
  load(): { counted: Record<number, CountedEntry>; note: string } | null {
    try {
      const raw = window.sessionStorage.getItem(this.key())
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  },
  save() {
    try {
      if (entries.value.length === 0 && !note.value) window.sessionStorage.removeItem(this.key())
      else {
        window.sessionStorage.setItem(
          this.key(),
          JSON.stringify({ counted: { ...counted }, note: note.value })
        )
      }
    } catch {
      // Private mode or full storage — the sheet still works, it just is not kept.
    }
  },
  remove() {
    try {
      window.sessionStorage.removeItem(this.key())
    } catch {
      // see save()
    }
  },
}

let restored = false
watch([counted, note], () => {
  if (restored) storage.save()
})

let navigating = false
let stopBefore: (() => void) | null = null
let stopStart: (() => void) | null = null
let stopFinish: (() => void) | null = null
let refreshTimer: ReturnType<typeof setInterval> | null = null

/** Fresh stock for the products not counted yet — sales go on while the supplier counts. */
function refreshStock() {
  if (navigating || submitting.value || document.hidden) return
  router.reload({ only: ['products', 'stockAsOf'] })
}

function onVisibility() {
  if (!document.hidden) refreshStock()
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (entries.value.length > 0 && !submitting.value) event.preventDefault()
}

onMounted(() => {
  const saved = storage.load()
  if (saved) {
    for (const [productId, entry] of Object.entries(saved.counted ?? {})) {
      counted[Number(productId)] = entry
    }
    note.value = saved.note ?? ''
  }
  restored = true

  stopStart = router.on('start', () => {
    navigating = true
  })
  stopFinish = router.on('finish', () => {
    navigating = false
  })
  // Filters, paging and the stock refresh stay on this page; anything else would drop the
  // sheet (it is kept for this tab only), so ask first.
  stopBefore = router.on('before', (event) => {
    const visit = event.detail.visit
    if (visit.method !== 'get' || entries.value.length === 0 || submitting.value) return
    if (visit.url.pathname === '/supplier/inventory') return
    event.preventDefault()
    confirm.require({
      header: t('inventory.leave_title'),
      message: tp('inventory.leave_message', entries.value.length),
      acceptLabel: t('inventory.leave_confirm'),
      rejectLabel: t('common.cancel'),
      destructive: true,
      accept: () => {
        clearSheet()
        router.visit(visit.url.href)
      },
    })
  })
  window.addEventListener('beforeunload', onBeforeUnload)
  document.addEventListener('visibilitychange', onVisibility)
  refreshTimer = setInterval(refreshStock, 30_000)
})

onBeforeUnmount(() => {
  stopBefore?.()
  stopStart?.()
  stopFinish?.()
  if (refreshTimer) clearInterval(refreshTimer)
  window.removeEventListener('beforeunload', onBeforeUnload)
  document.removeEventListener('visibilitychange', onVisibility)
})

function diffClass(diff: number | null) {
  if (diff === null || diff === 0) return 'text-gray-500 dark:text-zinc-400'
  return diff < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'
}
</script>

<template>
  <AppLayout>
    <Head :title="t('inventory.title')" />
    <ConfirmDialog />

    <h1 class="mb-3 flex min-h-10 items-center text-2xl font-bold text-gray-900 dark:text-zinc-100">
      {{ t('supplier.stock_title') }}
    </h1>
    <PageTabs :tabs="tabs" />

    <FilterBar :active="filtersActive" @clear="clearFilters">
      <!-- With nobody else stocking, "whose stock" is a question without a choice. -->
      <div v-if="page.props.hasOtherSuppliers !== false">
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('common.scope')
        }}</label>
        <Select
          v-model="filterScope"
          :options="scopeOptions"
          optionLabel="label"
          optionValue="value"
          class="w-48"
          data-testid="inventory-scope"
          @change="applyFilters"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('common.category')
        }}</label>
        <Select
          v-model="filterCategoryId"
          :options="categoryOptions"
          optionLabel="label"
          optionValue="value"
          class="w-48"
          data-testid="inventory-category"
          @change="applyFilters"
        />
      </div>
    </FilterBar>

    <Card class="mb-6">
      <template #content>
        <div class="space-y-1" data-testid="inventory-sheet">
          <template v-for="(product, index) in products" :key="product.productId">
            <!-- The sheet runs by category; a thin heading where the next one starts. -->
            <div
              v-if="index === 0 || products[index - 1].categoryName !== product.categoryName"
              class="flex items-center gap-2 px-2 pt-3 pb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-zinc-400"
              data-testid="inventory-category-heading"
            >
              <span
                class="inline-block h-2 w-2 rounded-full"
                :style="{ backgroundColor: product.categoryColor || '#6b7280' }"
                aria-hidden="true"
              />
              {{ product.categoryName ?? t('inventory.no_category') }}
            </div>
            <div
              class="flex flex-wrap items-center gap-3 rounded-md px-2 py-2"
              :class="
                counted[product.productId]
                  ? 'bg-green-50 dark:bg-green-900/10'
                  : 'odd:bg-gray-50 dark:odd:bg-zinc-800/50'
              "
              :data-testid="`inventory-row-${product.productId}`"
            >
              <div class="min-w-0 flex-1">
                <div class="font-medium text-gray-900 dark:text-zinc-100">
                  {{ product.productName }}
                </div>
              </div>
              <div class="w-28 text-sm text-gray-600 dark:text-zinc-300">
                {{
                  t('inventory.expected', {
                    count: counted[product.productId]?.expected ?? product.stock,
                  })
                }}
                <div
                  v-if="
                    counted[product.productId] &&
                    counted[product.productId].expected !== product.stock
                  "
                  class="text-xs text-gray-500 dark:text-zinc-400"
                  :data-testid="`inventory-stock-now-${product.productId}`"
                >
                  {{ t('inventory.stock_now', { count: product.stock }) }}
                </div>
              </div>
              <InputNumber
                :modelValue="counted[product.productId]?.counted ?? null"
                :min="0"
                :inputId="`inventory-counted-${product.productId}`"
                :aria-label="t('inventory.counted_for', { name: product.productName })"
                :placeholder="t('inventory.counted_placeholder')"
                inputClass="w-24"
                @update:modelValue="(value: number | null) => setCounted(product, value)"
                @keydown.enter.prevent="focusNext(product.productId)"
              />
              <!-- Mouse and touch only: Tab and Enter go from count to count. -->
              <Button
                icon="pi pi-check"
                severity="secondary"
                text
                size="small"
                tabindex="-1"
                :aria-label="t('inventory.matches', { name: product.productName })"
                :data-testid="`inventory-matches-${product.productId}`"
                @click="markMatches(product)"
              />
              <div
                class="w-20 text-right text-sm font-semibold"
                :class="diffClass(difference(product))"
                :data-testid="`inventory-diff-${product.productId}`"
              >
                {{ formatDiff(difference(product)) }}
              </div>
            </div>
          </template>
          <div
            v-if="products.length === 0"
            class="py-8 text-center text-gray-500 dark:text-zinc-400"
          >
            {{ t('inventory.no_products') }}
          </div>
        </div>

        <div class="mt-4">
          <label for="inventory-note" class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
            t('inventory.note')
          }}</label>
          <Textarea
            id="inventory-note"
            v-model="note"
            rows="2"
            autoResize
            class="w-full"
            :maxlength="ADJUSTMENT_NOTE_MAX"
          />
        </div>

        <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <span
              class="text-sm text-gray-700 dark:text-zinc-300"
              data-testid="inventory-summary"
              >{{
                t('inventory.summary', {
                  products: summary.products,
                  missing: summary.missing,
                  extra: summary.extra,
                })
              }}</span
            >
            <div
              v-if="countedOutsideFilter > 0"
              class="text-xs text-gray-500 dark:text-zinc-400"
              data-testid="inventory-outside-filter"
            >
              {{ tp('inventory.counted_outside_filter', countedOutsideFilter) }}
            </div>
          </div>
          <span class="inline-flex items-center gap-1">
            <Button
              :label="t('inventory.commit')"
              icon="pi pi-check"
              :disabled="entries.length === 0 || submitting"
              :loading="submitting"
              data-testid="inventory-commit"
              @click="submit"
            />
            <InfoHint
              mode="dialog"
              :title="t('inventory.commit')"
              :text="t('inventory.commit_hint')"
              test-id="inventory-commit-hint"
            />
          </span>
        </div>
      </template>
    </Card>

    <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
      <h2 class="text-lg font-semibold text-gray-800 dark:text-zinc-200">
        {{ t('inventory.history') }}
      </h2>
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('inventory.counted_by')
        }}</label>
        <Select
          v-model="filterWho"
          :options="whoOptions"
          optionLabel="label"
          optionValue="value"
          class="w-48"
          data-testid="inventory-who"
          @change="onWhoChange"
        />
      </div>
    </div>
    <PaginatedDataTable :value="counts.data" :meta="counts.meta" @page="onCountsPage">
      <Column :header="t('common.date')">
        <template #body="{ data }">
          <Link :href="`/supplier/inventory/${data.id}`" class="underline">{{
            formatDate(data.createdAt)
          }}</Link>
        </template>
      </Column>
      <Column :header="t('inventory.counted_by')">
        <template #body="{ data }">{{ data.actorName }}</template>
      </Column>
      <Column :header="t('inventory.products_counted')">
        <template #body="{ data }">{{ data.products }}</template>
      </Column>
      <Column :header="t('inventory.missing')">
        <template #body="{ data }">
          <span :class="data.lossQuantity ? 'text-red-600 dark:text-red-400' : ''"
            >{{ data.lossQuantity }} {{ t('common.pieces') }}</span
          >
        </template>
      </Column>
      <Column :header="t('inventory.extra')">
        <template #body="{ data }">{{ data.surplusQuantity }} {{ t('common.pieces') }}</template>
      </Column>
      <Column :header="t('inventory.loss_cost')">
        <template #body="{ data }">{{ money(data.lossCost) }}</template>
      </Column>
      <Column :header="t('inventory.loss_value')">
        <template #body="{ data }">{{ money(data.lossValue) }}</template>
      </Column>
      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('inventory.history_empty') }}
        </div>
      </template>
    </PaginatedDataTable>
  </AppLayout>
</template>
