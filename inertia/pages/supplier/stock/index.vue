<script setup lang="ts">
import { ref, computed } from 'vue'
import { Head, Link, router, usePage } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import Select from 'primevue/select'
import InputNumber from '~/components/NumberInput.vue'
import Dialog from 'primevue/dialog'
import Menu from 'primevue/menu'
import type { MenuItem } from 'primevue/menuitem'
import Textarea from 'primevue/textarea'
import { useI18n } from '~/composables/use_i18n'
import { useListFilters } from '~/composables/use_list_filters'
import { hasActiveFilters } from '~/composables/use_filter_params'
import FilterBar from '~/components/FilterBar.vue'
import InfoHint from '~/components/InfoHint.vue'
import PageTabs from '~/components/PageTabs.vue'
import PaginatedDataTable from '~/components/PaginatedDataTable.vue'
import IncomeLimitBanner, {
  type IncomeLimitStatus,
} from '~/components/supplier/IncomeLimitBanner.vue'
import { useMoney } from '~/composables/use_pricing'
import { formatDate } from '~/composables/use_format_date'
import { planFifoTake } from '~/composables/stock_fifo_rules'
import { WRITE_OFF_REASONS, ADJUSTMENT_NOTE_MAX } from '~/composables/use_shopping_validation'
import { DELIVERY_MAX_PRICE } from '~/composables/use_delivery_correction_validation'
import type { SharedProps } from '~/types'

interface StockRow {
  productId: number
  productName: string
  imagePath: string | null
  categoryName: string | null
  categoryColor: string | null
  totalSupplied: number
  totalRemaining: number
  totalSold: number
  soldInPeriod: number
  deliveredInPeriod: number
  deliveryCount: number
  totalStockValue: number
  /** Pieces in the viewer's own lots (an admin: every lot) — what "Změnit cenu" reprices. */
  myRemaining: number
  /** Pieces of the viewer's own lots only (an admin's own too). */
  ownRemaining: number
  /** Pieces of the product in the whole fridge, whatever the scope. */
  totalRemainingAll: number
  /** Selling price of the viewer's newest lot with pieces left; null when they have none. */
  currentPrice: number | null
}

interface StockResult {
  data: StockRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
  totals: { totalProducts: number; totalRemaining: number; totalStockValue: number }
  /** Products with 1–4 pieces — exactly what the "low" filter lists. */
  lowStockCount: number
  /** Sold-out products — exactly what the "out" filter lists. */
  outStockCount: number
}

type StockScope = 'all' | 'mine'
type StockState = 'all' | 'low' | 'out'

const props = defineProps<{
  stock: StockResult
  categories: Array<{ id: number; name: string; color: string }>
  filters: {
    categoryId: string
    sortBy: string
    sortOrder: string
    scope: StockScope
    stockState: StockState
  }
  /** The supplier's one open draft, when it has lines — "Naskladnit" continues it. */
  openDraft: { id: number; lines: number; pieces: number } | null
  incomeLimit: IncomeLimitStatus | null
}>()

const { t, tp } = useI18n()
const page = usePage<SharedProps>()
/** With nobody else stocking the fridge, "whole fridge" and "mine" are the same list. */
const showScope = computed(() => page.props.hasOtherSuppliers !== false)
const { money } = useMoney()
const ALL = '__all__'

const tabs = computed(() => [
  { label: t('common.tab_stock_state'), url: '/supplier/stock', testId: 'tab-stock-state' },
  {
    label: t('common.tab_stock_history'),
    url: '/supplier/deliveries',
    testId: 'tab-stock-history',
  },
  { label: t('common.tab_inventory'), url: '/supplier/inventory', testId: 'tab-inventory' },
])

// ─── Filters (server-side; `only` keeps shared data off the wire) ─────────────
const filterCategoryId = ref(props.filters.categoryId || ALL)
const filterScope = ref<StockScope>(props.filters.scope === 'mine' ? 'mine' : 'all')
const filterStockState = ref<StockState>(props.filters.stockState || 'all')
const filterSortBy = ref(props.filters.sortBy || 'productName')
const filterSortOrder = ref(props.filters.sortOrder || 'asc')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const scopeOptions = computed(() => [
  { label: t('common.scope_all'), value: 'all' },
  { label: t('common.scope_mine'), value: 'mine' },
])
const categoryOptions = computed(() => [
  { label: t('common.all'), value: ALL },
  ...props.categories.map((c) => ({ label: c.name, value: String(c.id) })),
])
const stockStateOptions = computed(() => [
  { label: t('common.all'), value: 'all' },
  { label: t('supplier.stock_state_low', { count: props.stock.lowStockCount }), value: 'low' },
  { label: t('supplier.stock_state_out', { count: props.stock.outStockCount }), value: 'out' },
])

function buildFilterParams() {
  return {
    categoryId: filterCategoryId.value === ALL ? undefined : filterCategoryId.value,
    scope: filterScope.value === 'all' ? undefined : filterScope.value,
    stockState: filterStockState.value === 'all' ? undefined : filterStockState.value,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
  }
}

const { applyFilters, navigateClear, onPageChange, navigateSort } = useListFilters({
  route: '/supplier/stock',
  onlyProps: ['stock', 'filters'],
  buildParams: buildFilterParams,
  getCurrentPage: () => props.stock.meta.currentPage,
})

const filtersActive = computed(() => hasActiveFilters(buildFilterParams()))

function clearFilters() {
  filterCategoryId.value = ALL
  filterScope.value = 'all'
  filterStockState.value = 'all'
  filterSortBy.value = 'productName'
  filterSortOrder.value = 'asc'
  navigateClear()
}

function onSort(event: { sortField: string; sortOrder: number }) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  navigateSort()
}

const summary = computed(() =>
  tp('supplier.stock_summary', props.stock.totals.totalProducts, {
    pieces: props.stock.totals.totalRemaining,
    value: money(props.stock.totals.totalStockValue),
  })
)

// ─── Stocking goes through the supplier's draft (příjemka) ────────────────────
/** Which "Stock" button is on its way (`0` = the header one) — every one waits for it. */
const receiving = ref<number | null>(null)
function receive(productId?: number) {
  if (receiving.value !== null) return
  receiving.value = productId ?? 0
  router.post('/supplier/stock/drafts', productId ? { productId } : {}, {
    onFinish: () => (receiving.value = null),
  })
}

/** "z toho moje N" in the whole fridge, "v lednici celkem N" in mine — only when they differ. */
function mixedStockNote(row: StockRow): string {
  if (props.filters.scope === 'mine') {
    return row.totalRemainingAll !== row.totalRemaining
      ? t('supplier.stock_mixed_total', { count: row.totalRemainingAll })
      : ''
  }
  return row.ownRemaining > 0 && row.ownRemaining !== row.totalRemaining
    ? t('supplier.stock_mixed_mine', { count: row.ownRemaining })
    : ''
}

function stockBadgeClass(remaining: number): string {
  if (remaining === 0) return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
  if (remaining <= 4) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
  return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200'
}

// ─── The lots of a product in stock, for both dialogs (loaded when one opens) ──
/** Mirrors `LotInStock` in app/services/delivery_service.ts. FIFO order. */
interface LotInStock {
  deliveryId: number
  createdAt: string
  supplier: { id: number; name: string }
  amountLeft: number
  price: number
  mine: boolean
  editable: boolean
}
const lots = ref<LotInStock[]>([])
const lotsLoading = ref(false)
const lotsFailed = ref(false)
/** Guards against a slow answer for a product whose dialog is already closed. */
let lotsRequest = 0

async function loadLots(productId: number): Promise<LotInStock[]> {
  const request = ++lotsRequest
  lots.value = []
  lotsFailed.value = false
  lotsLoading.value = true
  try {
    const response = await fetch(`/supplier/stock/products/${productId}/lots`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
    if (!response.ok) throw new Error(String(response.status))
    const body = (await response.json()) as { lots: LotInStock[] }
    if (request === lotsRequest) lots.value = body.lots
  } catch {
    if (request === lotsRequest) lotsFailed.value = true
  } finally {
    if (request === lotsRequest) lotsLoading.value = false
  }
  return lots.value
}

// ─── Write-off (pieces you know about: damaged, expired, stolen) ───────────────
type WriteOffReason = (typeof WRITE_OFF_REASONS)[number]
const writeOffVisible = ref(false)
const writeOffTarget = ref<{ productId: number; productName: string; stock: number } | null>(null)
const writeOffQuantity = ref<number | null>(1)
const writeOffReason = ref<WriteOffReason>('expired')
const writeOffNote = ref('')
const writeOffSubmitting = ref(false)
const writeOffReasons = computed(() =>
  WRITE_OFF_REASONS.map((reason) => ({ label: t(`inventory.reason_${reason}`), value: reason }))
)
/** What is really there — the loaded lots once they are in, the table row before that. */
const writeOffStock = computed(() =>
  lots.value.length > 0
    ? lots.value.reduce((sum, lot) => sum + lot.amountLeft, 0)
    : (writeOffTarget.value?.stock ?? 0)
)
const writeOffError = computed(() => {
  const target = writeOffTarget.value
  const quantity = writeOffQuantity.value
  if (!target) return ''
  if (!quantity || quantity < 1) return t('inventory.write_off_quantity_min')
  if (quantity > writeOffStock.value) {
    return t('inventory.write_off_quantity_max', { max: writeOffStock.value })
  }
  return ''
})
/** Live FIFO preview: the same plan the server follows (stock_fifo_rules mirrors it). */
const writeOffPlan = computed(() => {
  const quantity = writeOffError.value ? 0 : (writeOffQuantity.value ?? 0)
  const plan = planFifoTake(
    lots.value.map((lot) => ({ id: lot.deliveryId, amountLeft: lot.amountLeft })),
    quantity
  )
  return new Map(plan.map((step) => [step.id, step.take]))
})

// ─── Change the price of the pieces left, lot by lot (a sale or a price rise) ──
const repriceVisible = ref(false)
const repriceTarget = ref<{ productId: number; productName: string } | null>(null)
/** The price typed for each lot, by delivery id (only lots the viewer may change). */
const repricePrices = ref<Record<number, number | null>>({})
const repriceAll = ref<number | null>(null)
const repriceSubmitting = ref(false)

function priceInvalid(price: number | null): boolean {
  return price === null || !Number.isInteger(price) || price < 1 || price > DELIVERY_MAX_PRICE
}

const repriceMine = computed(() => lots.value.filter((lot) => lot.mine))
const repriceChanges = computed(() =>
  lots.value.filter((lot) => lot.editable && repricePrices.value[lot.deliveryId] !== lot.price)
)
const repriceInvalid = computed(() =>
  repriceChanges.value.some((lot) => priceInvalid(repricePrices.value[lot.deliveryId] ?? null))
)
const repriceSummary = computed(() =>
  tp('supplier.stock_reprice_summary', repriceChanges.value.length, {
    pieces: repriceChanges.value.reduce((sum, lot) => sum + lot.amountLeft, 0),
  })
)

async function openReprice(row: StockRow) {
  repriceTarget.value = { productId: row.productId, productName: row.productName }
  repricePrices.value = {}
  repriceAll.value = row.currentPrice
  repriceVisible.value = true
  const loaded = await loadLots(row.productId)
  repricePrices.value = Object.fromEntries(
    loaded.filter((lot) => lot.editable).map((lot) => [lot.deliveryId, lot.price])
  )
}

/** "Nastavit všem mým": the shortcut fills the viewer's own lots (an admin's own too). */
function applyRepriceAll() {
  if (priceInvalid(repriceAll.value)) return
  for (const lot of repriceMine.value) repricePrices.value[lot.deliveryId] = repriceAll.value
}

function submitReprice() {
  if (!repriceTarget.value || repriceChanges.value.length === 0 || repriceInvalid.value) return
  if (repriceSubmitting.value) return
  repriceSubmitting.value = true
  router.post(
    '/supplier/stock/reprice',
    {
      items: repriceChanges.value.map((lot) => ({
        deliveryId: lot.deliveryId,
        price: repricePrices.value[lot.deliveryId],
      })),
    },
    {
      preserveScroll: true,
      preserveState: true,
      only: ['stock', 'flash'],
      onSuccess: (response) => {
        const alert = (response.props.flash as { alert?: { type?: string } } | undefined)?.alert
        if (alert?.type !== 'danger') repriceVisible.value = false
        else void reloadRepriceLots()
      },
      onFinish: () => {
        repriceSubmitting.value = false
      },
    }
  )
}

/** A refused save (a lot sold out meanwhile): fresh lots, the typed prices kept. */
async function reloadRepriceLots() {
  if (!repriceTarget.value) return
  const typed = { ...repricePrices.value }
  const loaded = await loadLots(repriceTarget.value.productId)
  repricePrices.value = Object.fromEntries(
    loaded
      .filter((lot) => lot.editable)
      .map((lot) => [lot.deliveryId, typed[lot.deliveryId] ?? lot.price])
  )
}

// ─── Row actions on a phone: one button, a popup menu ──────────────────────────
// Three icons do not fit beside the product on 390 px; below `md` they share a menu.
const rowMenu = ref<InstanceType<typeof Menu> | null>(null)
const rowMenuItems = ref<MenuItem[]>([])

function openRowMenu(event: Event, row: StockRow) {
  rowMenuItems.value = [
    {
      label: t('supplier.stock_receive'),
      icon: 'pi pi-plus',
      testId: 'stock-menu-receive',
      disabled: receiving.value !== null,
      command: () => receive(row.productId),
    },
    ...(row.myRemaining > 0
      ? [
          {
            label: t('supplier.stock_reprice'),
            icon: 'pi pi-tag',
            testId: 'stock-menu-reprice',
            command: () => openReprice(row),
          },
        ]
      : []),
    ...(row.totalRemaining > 0
      ? [
          {
            label: t('inventory.write_off'),
            icon: 'pi pi-minus-circle',
            testId: 'stock-menu-write-off',
            command: () => openWriteOff(row),
          },
        ]
      : []),
  ]
  rowMenu.value?.toggle(event)
}

function openWriteOff(row: StockRow) {
  writeOffTarget.value = {
    productId: row.productId,
    productName: row.productName,
    stock: row.totalRemaining,
  }
  writeOffQuantity.value = 1
  writeOffReason.value = 'expired'
  writeOffNote.value = ''
  writeOffVisible.value = true
  void loadLots(row.productId)
}

// Both dialogs open on their first field: PrimeVue focuses the `autofocus` input once the
// dialog has faded in (a focus on @show would lose to its close button).

function submitWriteOff() {
  if (!writeOffTarget.value || writeOffError.value || writeOffSubmitting.value) return
  writeOffSubmitting.value = true
  router.post(
    '/supplier/stock/write-offs',
    {
      productId: writeOffTarget.value.productId,
      quantity: writeOffQuantity.value,
      reason: writeOffReason.value,
      ...(writeOffNote.value.trim() ? { note: writeOffNote.value.trim() } : {}),
      // What the dialog showed; the server takes its own FIFO and says if it differs.
      ...(lots.value.length > 0
        ? {
            preview: [...writeOffPlan.value].map(([deliveryId, quantity]) => ({
              deliveryId,
              quantity,
            })),
          }
        : {}),
    },
    {
      preserveScroll: true,
      preserveState: true,
      onSuccess: () => {
        writeOffVisible.value = false
      },
      onFinish: () => {
        writeOffSubmitting.value = false
      },
    }
  )
}
</script>

<template>
  <AppLayout>
    <Head :title="t('supplier.stock_title')" />

    <div class="mb-3 flex min-h-10 flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
        {{ t('supplier.stock_title') }}
      </h1>
      <div class="flex flex-wrap items-center gap-3">
        <Link
          v-if="openDraft"
          :href="`/supplier/stock/drafts/${openDraft.id}`"
          class="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50"
          data-testid="stock-draft-open"
        >
          {{ tp('supplier.stock_draft_open', openDraft.lines) }}
        </Link>
        <Button
          :label="t('supplier.stock_receive')"
          icon="pi pi-plus"
          :loading="receiving === 0"
          :disabled="receiving !== null"
          data-testid="stock-receive"
          @click="receive()"
        />
      </div>
    </div>
    <PageTabs :tabs="tabs" />

    <IncomeLimitBanner v-if="incomeLimit" :status="incomeLimit" class="mb-4" />

    <FilterBar :active="filtersActive" @clear="clearFilters">
      <div v-if="showScope">
        <label class="mb-1 flex items-center gap-1 text-sm text-gray-700 dark:text-zinc-300"
          >{{ t('common.scope') }}
          <InfoHint :text="t('supplier.stock_scope_hint')" test-id="stock-scope-hint"
        /></label>
        <Select
          v-model="filterScope"
          :options="scopeOptions"
          optionLabel="label"
          optionValue="value"
          class="w-48"
          data-testid="stock-scope"
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
          @change="applyFilters"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('supplier.stock_state')
        }}</label>
        <Select
          v-model="filterStockState"
          :options="stockStateOptions"
          optionLabel="label"
          optionValue="value"
          class="w-48"
          data-testid="stock-state"
          @change="applyFilters"
        />
      </div>
    </FilterBar>

    <p class="mb-2 text-sm text-gray-500 dark:text-zinc-400" data-testid="stock-summary">
      {{ summary }}
    </p>

    <PaginatedDataTable
      :value="stock.data"
      :meta="stock.meta"
      :sortField="filterSortBy"
      :sortOrder="sortOrderNum"
      @page="onPageChange"
      @sort="onSort"
    >
      <Column :header="t('common.product')" field="productName" sortable>
        <template #body="{ data }">
          <div class="flex items-center gap-3">
            <div
              class="hidden h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 p-0.5 sm:flex dark:bg-zinc-800"
            >
              <img
                v-if="data.imagePath"
                :src="data.imagePath"
                :alt="data.productName"
                class="h-full w-full rounded object-contain"
              />
              <span v-else class="pi pi-image text-sm text-gray-300 dark:text-zinc-600" />
            </div>
            <div class="flex min-w-0 flex-col items-start gap-0.5">
              <Link
                :href="`/supplier/products/${data.productId}/edit`"
                class="font-medium text-gray-900 hover:underline dark:text-zinc-100"
                >{{ data.productName }}</Link
              >
              <Tag
                v-if="data.categoryName"
                :value="data.categoryName"
                class="text-xs"
                :style="{ backgroundColor: data.categoryColor, color: '#fff' }"
              />
            </div>
          </div>
        </template>
      </Column>
      <Column
        :header="t('supplier.stock_in_stock')"
        field="totalRemaining"
        sortable
        headerClass="sbf-col-number"
        bodyClass="sbf-col-number"
      >
        <template #body="{ data }">
          <span
            class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
            :class="stockBadgeClass(data.totalRemaining)"
            >{{ data.totalRemaining }} {{ t('common.pieces') }}</span
          >
          <!-- Several suppliers stock this product: say how the number splits. -->
          <div
            v-if="mixedStockNote(data)"
            class="mt-0.5 text-xs text-gray-500 dark:text-zinc-400"
            data-testid="stock-mixed"
          >
            {{ mixedStockNote(data) }}
          </div>
        </template>
      </Column>
      <Column
        :header="t('supplier.stock_sold_30d')"
        field="soldInPeriod"
        sortable
        headerClass="sbf-col-number hidden md:table-cell"
        bodyClass="sbf-col-number hidden md:table-cell"
      >
        <template #body="{ data }">{{ data.soldInPeriod }} {{ t('common.pieces') }}</template>
      </Column>
      <Column
        :header="t('supplier.stock_stocked')"
        field="totalSupplied"
        sortable
        headerClass="sbf-col-number hidden md:table-cell"
        bodyClass="sbf-col-number hidden md:table-cell"
      >
        <template #body="{ data }">
          <Link
            :href="`/supplier/deliveries?productId=${data.productId}&scope=all`"
            class="hover:underline"
            >{{ data.totalSupplied }} {{ t('common.pieces') }}</Link
          >
        </template>
      </Column>
      <Column
        :header="t('supplier.stock_value')"
        field="totalStockValue"
        sortable
        headerClass="sbf-col-price hidden md:table-cell"
        bodyClass="sbf-col-price hidden md:table-cell"
      >
        <template #body="{ data }">{{ money(data.totalStockValue) }}</template>
      </Column>
      <Column :header="t('common.actions')" headerClass="sbf-col-action" bodyClass="sbf-col-action">
        <template #body="{ data }">
          <Button
            icon="pi pi-ellipsis-v"
            severity="secondary"
            text
            size="small"
            class="md:!hidden"
            :aria-label="t('common.actions')"
            aria-haspopup="true"
            data-testid="stock-row-actions"
            @click="openRowMenu($event, data)"
          />
          <div class="hidden gap-1 md:flex">
            <Button
              icon="pi pi-plus"
              severity="secondary"
              text
              size="small"
              :aria-label="t('supplier.stock_receive')"
              :loading="receiving === data.productId"
              :disabled="receiving !== null"
              data-testid="stock-row-receive"
              @click="receive(data.productId)"
            />
            <Button
              v-if="data.myRemaining > 0"
              icon="pi pi-tag"
              severity="secondary"
              text
              size="small"
              :aria-label="t('supplier.stock_reprice')"
              data-testid="stock-row-reprice"
              @click="openReprice(data)"
            />
            <Button
              v-if="data.totalRemaining > 0"
              icon="pi pi-minus-circle"
              severity="warn"
              text
              size="small"
              :aria-label="t('inventory.write_off')"
              data-testid="stock-row-write-off"
              @click="openWriteOff(data)"
            />
          </div>
        </template>
      </Column>

      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('supplier.stock_none') }}
        </div>
      </template>
    </PaginatedDataTable>

    <Menu ref="rowMenu" :model="rowMenuItems" popup data-testid="stock-row-menu">
      <template #item="{ item, props: itemProps }">
        <a v-bind="itemProps.action" :data-testid="item.testId">
          <span :class="item.icon" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </a>
      </template>
    </Menu>

    <Dialog
      v-model:visible="writeOffVisible"
      :header="
        writeOffTarget
          ? `${t('inventory.write_off_title')} · ${writeOffTarget.productName}`
          : t('inventory.write_off_title')
      "
      style="width: 560px; max-width: calc(100vw - 2rem)"
      modal
      :draggable="false"
      data-testid="write-off-dialog"
    >
      <form
        v-if="writeOffTarget"
        id="write-off-form"
        class="space-y-4"
        @submit.prevent="submitWriteOff"
      >
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              for="write-off-quantity"
              class="mb-1 flex items-center gap-1 text-sm text-gray-700 dark:text-zinc-300"
              >{{ t('inventory.write_off_quantity') }} *
              <InfoHint :text="t('inventory.write_off_fifo')" test-id="write-off-hint"
            /></label>
            <InputNumber
              v-model="writeOffQuantity"
              inputId="write-off-quantity"
              :pt="{ pcInputText: { root: { autofocus: true } } }"
              highlightOnFocus
              :min="1"
              fluid
              :invalid="!!writeOffError"
            />
            <small v-if="writeOffError" class="text-red-500 dark:text-red-400">{{
              writeOffError
            }}</small>
            <small v-else class="text-gray-500 dark:text-zinc-400" data-testid="write-off-stock">{{
              t('inventory.write_off_in_stock', { count: writeOffStock })
            }}</small>
          </div>
          <div>
            <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
              >{{ t('inventory.write_off_reason') }} *</label
            >
            <Select
              v-model="writeOffReason"
              :options="writeOffReasons"
              optionLabel="label"
              optionValue="value"
              class="w-full"
            />
          </div>
        </div>
        <div>
          <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
            t('inventory.write_off_note')
          }}</label>
          <Textarea
            v-model="writeOffNote"
            rows="2"
            class="w-full"
            :maxlength="ADJUSTMENT_NOTE_MAX"
            autoResize
          />
        </div>

        <!-- Which lots the pieces come off: oldest first, whoever stocked them. -->
        <div data-testid="write-off-lots">
          <div
            class="mb-1 hidden grid-cols-[6.5rem_1fr_4.5rem_5.5rem] gap-3 px-2 text-xs text-gray-500 md:grid dark:text-zinc-400"
          >
            <span>{{ t('supplier.stock_lots_stocked') }}</span>
            <span>{{ t('common.supplier') }}</span>
            <span class="text-right">{{ t('supplier.deliveries_remaining') }}</span>
            <span class="text-right">{{ t('inventory.write_off_takes') }}</span>
          </div>
          <p v-if="lotsLoading" class="px-2 text-sm text-gray-500 dark:text-zinc-400">
            {{ t('supplier.stock_lots_loading') }}
          </p>
          <p v-else-if="lotsFailed" class="px-2 text-sm text-red-500 dark:text-red-400">
            {{ t('supplier.stock_lots_failed') }}
          </p>
          <ul v-else class="divide-y divide-gray-100 rounded-lg border dark:divide-zinc-800">
            <li
              v-for="lot in lots"
              :key="lot.deliveryId"
              class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-2 py-1.5 text-sm md:grid-cols-[6.5rem_minmax(0,1fr)_4.5rem_5.5rem] md:items-center"
              :class="
                writeOffPlan.has(lot.deliveryId)
                  ? 'bg-amber-50 dark:bg-amber-900/20'
                  : 'text-gray-500 dark:text-zinc-400'
              "
              data-testid="write-off-lot"
              :data-delivery-id="lot.deliveryId"
            >
              <!-- Phone: date / supplier / pieces stacked on the left, the take on the right. -->
              <span class="col-start-1 row-start-1">{{ formatDate(lot.createdAt) }}</span>
              <span class="col-start-1 row-start-2 break-words md:col-start-2 md:row-start-1">
                {{ lot.supplier.name }}
                <span
                  v-if="!lot.mine && writeOffPlan.has(lot.deliveryId)"
                  class="block text-xs text-gray-500 dark:text-zinc-400"
                  data-testid="write-off-lot-notified"
                  ><span class="pi pi-envelope mr-1 !text-[0.7rem]" aria-hidden="true" />{{
                    t('inventory.write_off_notified')
                  }}</span
                >
              </span>
              <span
                class="col-start-1 row-start-3 text-gray-500 md:col-start-3 md:row-start-1 md:text-right dark:text-zinc-400"
              >
                <span class="md:hidden">{{ t('supplier.deliveries_remaining') }}: </span
                >{{ lot.amountLeft }} {{ t('common.pieces') }}
              </span>
              <span
                class="col-start-2 row-span-3 row-start-1 self-center text-right font-medium md:col-start-4 md:row-span-1"
                data-testid="write-off-lot-take"
              >
                <template v-if="writeOffPlan.has(lot.deliveryId)">
                  <span class="md:hidden">{{ t('inventory.write_off_takes') }}: </span>−{{
                    writeOffPlan.get(lot.deliveryId)
                  }}
                  {{ t('common.pieces') }}
                </template>
              </span>
            </li>
          </ul>
        </div>
      </form>
      <template #footer>
        <Button
          :label="t('common.cancel')"
          severity="secondary"
          text
          @click="writeOffVisible = false"
        />
        <Button
          type="submit"
          form="write-off-form"
          :label="t('inventory.write_off_confirm')"
          severity="danger"
          :disabled="!!writeOffError || writeOffSubmitting"
          :loading="writeOffSubmitting"
          data-testid="write-off-confirm"
        />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="repriceVisible"
      :header="
        repriceTarget
          ? `${t('supplier.stock_reprice')} · ${repriceTarget.productName}`
          : t('supplier.stock_reprice')
      "
      style="width: 560px; max-width: calc(100vw - 2rem)"
      modal
      :draggable="false"
      data-testid="reprice-dialog"
    >
      <form
        v-if="repriceTarget"
        id="reprice-form"
        class="space-y-4"
        @submit.prevent="submitReprice"
      >
        <div v-if="repriceMine.length > 0 || lotsLoading">
          <label
            for="reprice-all"
            class="mb-1 flex items-center gap-1 text-sm text-gray-700 dark:text-zinc-300"
            >{{ t('supplier.stock_reprice_set_mine') }}
            <InfoHint :text="t('supplier.stock_reprice_hint')" test-id="reprice-hint" />
          </label>
          <div class="flex items-center gap-2" @keydown.enter.prevent="applyRepriceAll">
            <InputNumber
              v-model="repriceAll"
              inputId="reprice-all"
              :pt="{ pcInputText: { root: { autofocus: true } } }"
              highlightOnFocus
              :min="1"
              :suffix="' ' + t('common.currency')"
              class="w-40"
              inputClass="w-full min-w-0"
              :invalid="repriceAll !== null && priceInvalid(repriceAll)"
            />
            <Button
              :label="t('supplier.stock_reprice_set_mine_apply')"
              severity="secondary"
              text
              size="small"
              :disabled="priceInvalid(repriceAll) || lotsLoading"
              data-testid="reprice-apply-all"
              @click="applyRepriceAll"
            />
          </div>
        </div>

        <div data-testid="reprice-lots">
          <div
            class="mb-1 hidden grid-cols-[6.5rem_1fr_4.5rem_8rem] gap-3 px-2 text-xs text-gray-500 md:grid dark:text-zinc-400"
          >
            <span>{{ t('supplier.stock_lots_stocked') }}</span>
            <span>{{ t('common.supplier') }}</span>
            <span class="text-right">{{ t('supplier.deliveries_remaining') }}</span>
            <span class="text-right">{{ t('supplier.deliveries_price') }}</span>
          </div>
          <p v-if="lotsLoading" class="px-2 text-sm text-gray-500 dark:text-zinc-400">
            {{ t('supplier.stock_lots_loading') }}
          </p>
          <p v-else-if="lotsFailed" class="px-2 text-sm text-red-500 dark:text-red-400">
            {{ t('supplier.stock_lots_failed') }}
          </p>
          <ul v-else class="divide-y divide-gray-100 rounded-lg border dark:divide-zinc-800">
            <li
              v-for="(lot, index) in lots"
              :key="lot.deliveryId"
              class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-2 py-1.5 text-sm md:grid-cols-[6.5rem_minmax(0,1fr)_4.5rem_8rem] md:items-center"
              data-testid="reprice-lot"
              :data-delivery-id="lot.deliveryId"
            >
              <!-- Phone: date / supplier / pieces stacked on the left, the price on the right. -->
              <span class="col-start-1 row-start-1">
                {{ formatDate(lot.createdAt) }}
                <span
                  v-if="index === 0"
                  class="ml-1 text-xs text-gray-500 md:ml-0 md:block dark:text-zinc-400"
                  data-testid="reprice-lot-first"
                  >{{ t('supplier.stock_lots_sells_first') }}</span
                >
              </span>
              <span class="col-start-1 row-start-2 break-words md:col-start-2 md:row-start-1">{{
                lot.supplier.name
              }}</span>
              <span
                class="col-start-1 row-start-3 text-gray-500 md:col-start-3 md:row-start-1 md:text-right dark:text-zinc-400"
              >
                <span class="md:hidden">{{ t('supplier.deliveries_remaining') }}: </span
                >{{ lot.amountLeft }} {{ t('common.pieces') }}
              </span>
              <span
                class="col-start-2 row-span-3 row-start-1 flex items-center justify-end md:col-start-4 md:row-span-1"
              >
                <InputNumber
                  v-if="lot.editable"
                  v-model="repricePrices[lot.deliveryId]"
                  :min="1"
                  :suffix="' ' + t('common.currency')"
                  class="w-28 md:w-32"
                  inputClass="w-full min-w-0"
                  :ariaLabel="
                    t('supplier.stock_reprice_lot_aria', {
                      date: formatDate(lot.createdAt),
                      supplier: lot.supplier.name,
                    })
                  "
                  data-testid="reprice-lot-price"
                  :invalid="
                    repricePrices[lot.deliveryId] !== lot.price &&
                    priceInvalid(repricePrices[lot.deliveryId] ?? null)
                  "
                />
                <span v-else class="py-1.5" data-testid="reprice-lot-readonly">{{
                  money(lot.price)
                }}</span>
              </span>
            </li>
          </ul>
        </div>
        <p
          v-if="repriceChanges.length > 0"
          class="text-sm text-gray-500 dark:text-zinc-400"
          data-testid="reprice-summary"
        >
          {{
            repriceInvalid
              ? t('supplier.stock_reprice_invalid', { max: DELIVERY_MAX_PRICE })
              : repriceSummary
          }}
        </p>
      </form>
      <template #footer>
        <Button
          :label="t('common.cancel')"
          severity="secondary"
          text
          @click="repriceVisible = false"
        />
        <Button
          type="submit"
          form="reprice-form"
          :label="t('common.save')"
          :disabled="repriceChanges.length === 0 || repriceInvalid || repriceSubmitting"
          :loading="repriceSubmitting"
          data-testid="reprice-confirm"
        />
      </template>
    </Dialog>
  </AppLayout>
</template>
