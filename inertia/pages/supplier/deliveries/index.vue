<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Head, Link, router, usePage } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Select from 'primevue/select'
import Button from 'primevue/button'
import Column from 'primevue/column'
import ConfirmDialog from 'primevue/confirmdialog'
import { useAppConfirm } from '~/composables/use_app_confirm'
import { useI18n } from '~/composables/use_i18n'
import { formatDate } from '~/composables/use_format_date'
import { useListFilters } from '~/composables/use_list_filters'
import { hasActiveFilters } from '~/composables/use_filter_params'
import { useSelectEnterKey } from '~/composables/use_select_enter_key'
import { useMoney } from '~/composables/use_pricing'
import FilterBar from '~/components/FilterBar.vue'
import PageTabs from '~/components/PageTabs.vue'
import PaginatedDataTable from '~/components/PaginatedDataTable.vue'
import DeliveryCorrectionDialog from '~/components/DeliveryCorrectionDialog.vue'
import type { CorrectableDelivery } from '~/components/DeliveryCorrectionDialog.vue'
import type { SharedProps } from '~/types'

interface ProductOption {
  id: number
  displayName: string
  imagePath: string | null
  category: { name: string; color: string } | null
}

interface DeliveryRow {
  id: number
  amountSupplied: number
  amountLeft: number
  price: number
  purchasePrice: number | null
  lostCount: number
  createdAt: string
  voidedAt: string | null
  product: { displayName: string; category?: { name: string } }
  supplierName: string
  soldCount: number
  invoicedCount: number
  uninvoicedCount: number
  uninvoicedBuyerCount: number
  correctionCount: number
  /** The stocking draft the lot came from, when the viewer may open it. */
  stockDraftId: number | null
  /** Set when the lot was handed over (out) or taken over (in) from a leaving supplier. */
  transfer: {
    direction: 'out' | 'in'
    counterpart: string
    pieces: number
    at: string
  } | null
  lastCorrection: {
    kind: 'update' | 'void' | 'reprice'
    reason: string
    oldPrice: number
    newPrice: number
    createdAt: string
  } | null
  canCorrect: boolean
}

/** Mirrors `AdjustmentRow` in app/services/stock_history_service.ts. */
interface AdjustmentRow {
  id: number
  createdAt: string
  productId: number
  productName: string
  kind: 'loss' | 'surplus'
  quantity: number
  reason: string
  note: string | null
  unitCost: number | null
  unitPrice: number
  lotSupplierName: string
  actorName: string
  inventoryCountId: number | null
  revertedAt: string | null
  revertible: boolean
}

interface PageMeta {
  total: number
  perPage: number
  currentPage: number
  lastPage: number
}

type HistoryType = 'deliveries' | 'adjustments' | 'drafts'
type HistoryScope = 'all' | 'mine'

/** A stocked draft (příjemka) — mirrors `StockedDraftRow` in stock_draft_service.ts. */
interface DraftRow {
  id: number
  supplierId: number
  supplierName: string
  status: 'committed' | 'voided'
  committedAt: string
  lines: number
  pieces: number
  /** Null for a colleague's draft — their purchase prices are theirs. */
  purchaseTotal: number | null
}

const props = defineProps<{
  products: ProductOption[]
  recentDeliveries: { data: DeliveryRow[]; meta: PageMeta }
  adjustments: { data: AdjustmentRow[]; meta: PageMeta }
  drafts: { data: DraftRow[]; meta: PageMeta }
  filters: {
    productId: string
    sortBy: string
    sortOrder: string
    scope: HistoryScope
    type: HistoryType
    reason: string
  }
}>()

const { t } = useI18n()
const confirm = useAppConfirm()
const { money } = useMoney()
const page = usePage<SharedProps>()
// Alone in the fridge, "mine" and "all" are the same list — the scope filter would be noise.
const showScope = computed(() => page.props.hasOtherSuppliers !== false)
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

const filterType = ref<HistoryType>(
  props.filters.type === 'adjustments' || props.filters.type === 'drafts'
    ? props.filters.type
    : 'deliveries'
)
const filterScope = ref<HistoryScope>(props.filters.scope === 'mine' ? 'mine' : 'all')
const filterProductId = ref(props.filters.productId || ALL)
const filterReason = ref(props.filters.reason || ALL)
/** Drafts sort by their number, the other tables by date — newest first everywhere. */
const defaultSortBy = (type: HistoryType) => (type === 'drafts' ? 'id' : 'createdAt')
const filterSortBy = ref(props.filters.sortBy || defaultSortBy(filterType.value))
const filterSortOrder = ref(props.filters.sortOrder || 'desc')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const showAdjustments = computed(() => props.filters.type === 'adjustments')
const showDrafts = computed(() => props.filters.type === 'drafts')
const meta = computed(() =>
  showAdjustments.value
    ? props.adjustments.meta
    : showDrafts.value
      ? props.drafts.meta
      : props.recentDeliveries.meta
)

const typeOptions = computed(() => [
  { label: t('supplier.history_type_deliveries'), value: 'deliveries' },
  { label: t('supplier.history_type_adjustments'), value: 'adjustments' },
  { label: t('supplier.history_type_drafts'), value: 'drafts' },
])
// Same labels, order and default (the whole fridge) as the stock page.
const scopeOptions = computed(() => [
  { label: t('common.scope_all'), value: 'all' },
  { label: t('common.scope_mine'), value: 'mine' },
])
const reasonOptions = computed(() => [
  { label: t('common.all'), value: ALL },
  ...['inventory', 'damaged', 'expired', 'stolen', 'other'].map((reason) => ({
    label: t(`inventory.reason_${reason}`),
    value: reason,
  })),
])
const productFilterOptions = computed(() => [
  { label: t('common.all'), value: ALL },
  ...props.products.map((p) => ({ label: p.displayName, value: String(p.id) })),
])

const productFilterSelect = ref<any>(null)
const { onSelectShow } = useSelectEnterKey([
  {
    selectRef: productFilterSelect,
    getOptions: () => productFilterOptions.value,
    getLabel: (o) => o.label,
    getValue: (o) => o.value,
    onSelect: (v) => {
      filterProductId.value = v as string
    },
  },
])

// The two tables sort by different columns — switching the type starts from the default.
// `sync`: the Select applies the filters on change, before a default watcher would run.
watch(
  filterType,
  () => {
    filterSortBy.value = defaultSortBy(filterType.value)
    filterSortOrder.value = 'desc'
    filterReason.value = ALL
  },
  { flush: 'sync' }
)

function buildFilterParams() {
  return {
    type: filterType.value === 'deliveries' ? undefined : filterType.value,
    scope: filterScope.value === 'all' ? undefined : filterScope.value,
    productId: filterProductId.value === ALL ? undefined : filterProductId.value,
    reason:
      filterType.value === 'adjustments' && filterReason.value !== ALL
        ? filterReason.value
        : undefined,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
  }
}

const { applyFilters, navigateClear, onPageChange, navigateSort } = useListFilters({
  route: '/supplier/deliveries',
  onlyProps: ['recentDeliveries', 'adjustments', 'drafts', 'filters'],
  buildParams: buildFilterParams,
  getCurrentPage: () => meta.value.currentPage,
})

const filtersActive = computed(() => hasActiveFilters(buildFilterParams()))

function clearFilters() {
  filterType.value = 'deliveries'
  filterScope.value = 'all'
  filterProductId.value = ALL
  filterReason.value = ALL
  filterSortBy.value = 'createdAt'
  filterSortOrder.value = 'desc'
  navigateClear()
}

function onSort(event: { sortField: string; sortOrder: number }) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  navigateSort()
}

/** `inventory` on a loss means nobody has said why yet; a surplus always comes from a count. */
function adjustmentReason(row: AdjustmentRow): string {
  if (row.kind === 'surplus') return t('inventory.reason_surplus')
  if (row.reason === 'inventory') return t('supplier.history_reason_not_yet')
  return t(`inventory.reason_${row.reason}`)
}

// ─── Taking a mistaken write-off back ─────────────────────────────────────────
const revertingId = ref<number | null>(null)

function revertWriteOff(row: AdjustmentRow) {
  confirm.require({
    header: t('supplier.history_revert_title'),
    message: t('supplier.history_revert_message', {
      quantity: row.quantity,
      product: row.productName,
    }),
    acceptLabel: t('supplier.history_revert'),
    rejectLabel: t('common.cancel'),
    accept: () => {
      revertingId.value = row.id
      router.put(
        `/supplier/stock/write-offs/${row.id}/revert`,
        {},
        {
          preserveScroll: true,
          preserveState: true,
          only: ['adjustments', 'filters'],
          onFinish: () => {
            revertingId.value = null
          },
        }
      )
    },
  })
}

/** A reverted write-off stays listed for the record, greyed out. */
function adjustmentRowClass(row: AdjustmentRow): string {
  return row.revertedAt ? 'opacity-60' : ''
}

/** A voided lot stays listed for the record, but greyed out. */
function deliveryRowClass(row: DeliveryRow): string {
  return row.voidedAt ? 'opacity-60' : ''
}

// ─── Corrections ──────────────────────────────────────────────────────────────
const correctionVisible = ref(false)
const correctionMode = ref<'edit' | 'void'>('edit')
const correctionTarget = ref<CorrectableDelivery | null>(null)

function toCorrectable(row: DeliveryRow): CorrectableDelivery {
  return {
    id: row.id,
    productName: row.product?.displayName ?? '—',
    amountSupplied: row.amountSupplied,
    amountLeft: row.amountLeft,
    price: row.price,
    purchasePrice: row.purchasePrice,
    soldCount: row.soldCount,
    invoicedCount: row.invoicedCount,
    uninvoicedCount: row.uninvoicedCount,
    uninvoicedBuyerCount: row.uninvoicedBuyerCount,
  }
}

function openCorrection(row: DeliveryRow, mode: 'edit' | 'void') {
  correctionTarget.value = toCorrectable(row)
  correctionMode.value = mode
  correctionVisible.value = true
}

// A refused correction keeps the dialog open; show it the delivery's fresh numbers.
watch(
  () => props.recentDeliveries.data,
  (rows) => {
    if (!correctionVisible.value || !correctionTarget.value) return
    const fresh = rows.find((row) => row.id === correctionTarget.value!.id)
    if (fresh) correctionTarget.value = toCorrectable(fresh)
  }
)
</script>

<template>
  <AppLayout>
    <ConfirmDialog />
    <Head :title="`${t('supplier.stock_title')} · ${t('common.tab_stock_history')}`" />

    <h1 class="mb-3 min-h-10 text-2xl font-bold text-gray-900 dark:text-zinc-100">
      {{ t('supplier.stock_title') }}
    </h1>
    <PageTabs :tabs="tabs" />

    <FilterBar :active="filtersActive" @clear="clearFilters">
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('supplier.history_type')
        }}</label>
        <Select
          v-model="filterType"
          :options="typeOptions"
          optionLabel="label"
          optionValue="value"
          class="w-48"
          data-testid="history-type"
          @change="applyFilters"
        />
      </div>
      <div v-if="showScope">
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('common.scope')
        }}</label>
        <Select
          v-model="filterScope"
          :options="scopeOptions"
          optionLabel="label"
          optionValue="value"
          class="w-48"
          data-testid="deliveries-scope"
          @change="applyFilters"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('common.product')
        }}</label>
        <Select
          ref="productFilterSelect"
          v-model="filterProductId"
          :options="productFilterOptions"
          optionLabel="label"
          optionValue="value"
          class="w-64"
          filter
          @show="onSelectShow"
          @change="applyFilters"
        />
      </div>
      <div v-if="filterType === 'adjustments'">
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('inventory.reason_column')
        }}</label>
        <Select
          v-model="filterReason"
          :options="reasonOptions"
          optionLabel="label"
          optionValue="value"
          class="w-48"
          data-testid="history-reason"
          @change="applyFilters"
        />
      </div>
    </FilterBar>

    <!-- Write-offs and inventory differences -->
    <PaginatedDataTable
      v-if="showAdjustments"
      :value="adjustments.data"
      :meta="adjustments.meta"
      :sortField="filterSortBy"
      :sortOrder="sortOrderNum"
      data-testid="history-adjustments"
      :rowClass="adjustmentRowClass"
      @page="onPageChange"
      @sort="onSort"
    >
      <Column
        :header="t('common.date')"
        field="createdAt"
        sortable
        headerClass="sbf-col-date hidden md:table-cell"
        bodyClass="sbf-col-date hidden md:table-cell"
      >
        <template #body="{ data }">{{ formatDate(data.createdAt) }}</template>
      </Column>
      <Column :header="t('common.product')" field="productName" sortable>
        <template #body="{ data }">
          <div>{{ data.productName }}</div>
          <div class="text-xs text-gray-500 md:hidden dark:text-zinc-400">
            {{ formatDate(data.createdAt) }}
          </div>
        </template>
      </Column>
      <Column
        :header="t('supplier.history_change')"
        field="quantity"
        sortable
        headerClass="sbf-col-number"
        bodyClass="sbf-col-number"
      >
        <template #body="{ data }">
          <span
            class="font-medium"
            data-testid="adjustment-quantity"
            :class="[
              data.kind === 'surplus'
                ? 'text-green-700 dark:text-green-400'
                : 'text-red-600 dark:text-red-400',
              { 'line-through': data.revertedAt },
            ]"
            >{{ data.kind === 'surplus' ? '+' : '−' }}{{ data.quantity }}
            {{ t('common.pieces') }}</span
          >
          <span
            v-if="data.revertedAt"
            class="ml-1 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-zinc-700 dark:text-zinc-200"
            data-testid="adjustment-reverted"
            >{{ t('supplier.history_reverted') }}</span
          >
        </template>
      </Column>
      <Column :header="t('inventory.reason_column')">
        <template #body="{ data }">
          <div>{{ adjustmentReason(data) }}</div>
          <div class="text-xs text-gray-500 dark:text-zinc-400">
            <Link
              v-if="data.inventoryCountId"
              :href="`/supplier/inventory/${data.inventoryCountId}`"
              class="hover:underline"
              >{{ t('supplier.history_inventory_link', { id: data.inventoryCountId }) }}</Link
            >
            <span v-if="data.inventoryCountId && data.note"> · </span>
            <span v-if="data.note">{{ data.note }}</span>
          </div>
        </template>
      </Column>
      <Column
        :header="t('supplier.deliveries_purchase_price')"
        headerClass="sbf-col-price hidden md:table-cell"
        bodyClass="sbf-col-price hidden md:table-cell"
      >
        <template #body="{ data }">{{ money(data.unitCost) }}</template>
      </Column>
      <Column
        :header="t('supplier.deliveries_price')"
        headerClass="sbf-col-price hidden md:table-cell"
        bodyClass="sbf-col-price hidden md:table-cell"
      >
        <template #body="{ data }">{{ money(data.unitPrice) }}</template>
      </Column>
      <Column
        v-if="filters.scope === 'all'"
        :header="t('supplier.history_lot_supplier')"
        headerClass="hidden md:table-cell"
        bodyClass="hidden md:table-cell"
      >
        <template #body="{ data }">{{ data.lotSupplierName }}</template>
      </Column>
      <Column
        :header="t('supplier.history_actor')"
        headerClass="hidden md:table-cell"
        bodyClass="hidden md:table-cell"
      >
        <template #body="{ data }">{{ data.actorName }}</template>
      </Column>
      <Column headerClass="w-12" bodyClass="w-12">
        <template #body="{ data }">
          <Button
            v-if="data.revertible"
            icon="pi pi-undo"
            severity="secondary"
            text
            size="small"
            :aria-label="t('supplier.history_revert_for', { product: data.productName })"
            :loading="revertingId === data.id"
            :disabled="revertingId !== null"
            data-testid="adjustment-revert"
            @click="revertWriteOff(data)"
          />
        </template>
      </Column>
      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('supplier.history_adjustments_none') }}
        </div>
      </template>
    </PaginatedDataTable>

    <!-- Stocked drafts (příjemky) -->
    <PaginatedDataTable
      v-else-if="showDrafts"
      :value="drafts.data"
      :meta="drafts.meta"
      :sortField="filterSortBy"
      :sortOrder="sortOrderNum"
      dataKey="id"
      data-testid="history-drafts"
      @page="onPageChange"
      @sort="onSort"
    >
      <Column :header="t('supplier.history_draft_number')" field="id" sortable>
        <template #body="{ data }">
          <Link
            :href="`/supplier/stock/drafts/${data.id}`"
            class="font-medium text-gray-900 hover:underline dark:text-zinc-100"
            data-testid="history-draft-link"
            >{{ t('shopping.draft_link', { id: data.id }) }}</Link
          >
          <div class="text-xs text-gray-500 md:hidden dark:text-zinc-400">
            {{ formatDate(data.committedAt) }}
          </div>
        </template>
      </Column>
      <Column
        :header="t('supplier.history_draft_stocked')"
        field="committedAt"
        sortable
        headerClass="sbf-col-date hidden md:table-cell"
        bodyClass="sbf-col-date hidden md:table-cell"
      >
        <template #body="{ data }">{{ formatDate(data.committedAt) }}</template>
      </Column>
      <Column
        v-if="filterScope === 'all'"
        :header="t('common.supplier')"
        headerClass="hidden md:table-cell"
        bodyClass="hidden md:table-cell"
      >
        <template #body="{ data }">{{ data.supplierName }}</template>
      </Column>
      <Column
        :header="t('supplier.history_draft_lines')"
        field="lines"
        sortable
        headerClass="sbf-col-number hidden sm:table-cell"
        bodyClass="sbf-col-number hidden sm:table-cell"
      >
        <template #body="{ data }">{{ data.lines }}</template>
      </Column>
      <Column
        :header="t('common.pieces')"
        field="pieces"
        sortable
        headerClass="sbf-col-number"
        bodyClass="sbf-col-number"
      >
        <template #body="{ data }">{{ data.pieces }}</template>
      </Column>
      <Column
        :header="t('supplier.history_draft_purchase')"
        headerClass="sbf-col-price hidden md:table-cell"
        bodyClass="sbf-col-price hidden md:table-cell"
      >
        <template #body="{ data }">
          <span v-if="data.purchaseTotal !== null">{{ money(data.purchaseTotal) }}</span>
          <span
            v-else
            class="text-gray-400 dark:text-zinc-500"
            :aria-label="t('supplier.history_draft_purchase_hidden')"
            >—</span
          >
        </template>
      </Column>
      <Column :header="t('common.status')">
        <template #body="{ data }">
          <span
            class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
            :class="
              data.status === 'voided'
                ? 'bg-gray-100 text-gray-800 dark:bg-zinc-700 dark:text-zinc-200'
                : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200'
            "
            data-testid="history-draft-status"
            >{{ t(`supplier.history_draft_status_${data.status}`) }}</span
          >
        </template>
      </Column>
      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('common.no_data') }}
        </div>
      </template>
    </PaginatedDataTable>

    <!-- Deliveries (lots) with their corrections -->
    <PaginatedDataTable
      v-else
      :value="recentDeliveries.data"
      :meta="recentDeliveries.meta"
      :sortField="filterSortBy"
      :sortOrder="sortOrderNum"
      :rowClass="deliveryRowClass"
      data-testid="history-deliveries"
      @page="onPageChange"
      @sort="onSort"
    >
      <Column
        :header="t('common.date')"
        field="createdAt"
        sortable
        headerClass="sbf-col-date hidden md:table-cell"
        bodyClass="sbf-col-date hidden md:table-cell"
      >
        <template #body="{ data }">{{ formatDate(data.createdAt) }}</template>
      </Column>
      <Column :header="t('common.product')">
        <template #body="{ data }">
          <div class="flex flex-wrap items-center gap-x-2">
            <span>{{ data.product?.displayName ?? '—' }}</span>
            <span
              v-if="data.voidedAt"
              class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-zinc-700 dark:text-zinc-200"
              data-testid="delivery-status-voided"
              >{{ t('supplier.deliveries_status_voided') }}</span
            >
          </div>
          <div class="text-xs text-gray-500 md:hidden dark:text-zinc-400">
            {{ formatDate(data.createdAt) }}
          </div>
          <Link
            v-if="data.stockDraftId"
            :href="`/supplier/stock/drafts/${data.stockDraftId}`"
            class="text-xs text-gray-500 hover:underline dark:text-zinc-400"
            data-testid="delivery-draft-link"
            >{{ t('shopping.draft_link', { id: data.stockDraftId }) }}</Link
          >
          <div
            v-if="data.transfer"
            class="text-xs text-gray-500 dark:text-zinc-400"
            data-testid="delivery-transfer"
          >
            {{
              data.transfer.direction === 'out'
                ? t('supplier.deliveries_transfer_out', {
                    name: data.transfer.counterpart,
                    date: formatDate(data.transfer.at),
                    count: data.transfer.pieces,
                  })
                : t('supplier.deliveries_transfer_in', {
                    name: data.transfer.counterpart,
                    date: formatDate(data.transfer.at),
                  })
            }}
          </div>
          <div
            v-if="data.lastCorrection"
            class="text-xs text-gray-500 dark:text-zinc-400"
            data-testid="delivery-last-correction"
          >
            {{
              data.lastCorrection.kind === 'reprice'
                ? t('supplier.deliveries_last_reprice', {
                    date: formatDate(data.lastCorrection.createdAt),
                    from: money(data.lastCorrection.oldPrice),
                    to: money(data.lastCorrection.newPrice),
                  })
                : t('supplier.deliveries_last_correction', {
                    date: formatDate(data.lastCorrection.createdAt),
                    reason: data.lastCorrection.reason,
                  })
            }}
          </div>
        </template>
      </Column>
      <Column
        v-if="filters.scope === 'all'"
        :header="t('common.supplier')"
        headerClass="hidden md:table-cell"
        bodyClass="hidden md:table-cell"
      >
        <template #body="{ data }">{{ data.supplierName }}</template>
      </Column>
      <Column
        :header="t('supplier.deliveries_amount')"
        headerClass="sbf-col-number"
        bodyClass="sbf-col-number"
      >
        <template #body="{ data }">{{ data.amountSupplied }} {{ t('common.pieces') }}</template>
      </Column>
      <Column
        :header="t('supplier.deliveries_remaining')"
        headerClass="sbf-col-number hidden md:table-cell"
        bodyClass="sbf-col-number hidden md:table-cell"
      >
        <template #body="{ data }">
          <div>{{ data.amountLeft }} {{ t('common.pieces') }}</div>
          <div
            v-if="data.lostCount > 0"
            class="text-xs text-red-600 dark:text-red-400"
            data-testid="delivery-lost"
          >
            {{ t('supplier.deliveries_lost', { count: data.lostCount }) }}
          </div>
          <div
            v-else-if="data.lostCount < 0"
            class="text-xs text-green-700 dark:text-green-400"
            data-testid="delivery-found"
          >
            {{ t('supplier.deliveries_found', { count: -data.lostCount }) }}
          </div>
        </template>
      </Column>
      <Column
        :header="t('supplier.deliveries_price')"
        field="price"
        sortable
        headerClass="sbf-col-price hidden md:table-cell"
        bodyClass="sbf-col-price hidden md:table-cell"
      >
        <template #body="{ data }">
          <div>{{ money(data.price) }}</div>
          <div v-if="data.purchasePrice !== null" class="text-xs text-gray-500 dark:text-zinc-400">
            {{ t('supplier.deliveries_purchase_short', { price: money(data.purchasePrice) }) }}
          </div>
        </template>
      </Column>
      <Column :header="t('common.actions')" headerClass="sbf-col-action" bodyClass="sbf-col-action">
        <template #body="{ data }">
          <div v-if="data.canCorrect && !data.voidedAt" class="flex gap-1">
            <Button
              icon="pi pi-pencil"
              severity="info"
              text
              size="small"
              :aria-label="t('supplier.correction_edit')"
              data-testid="delivery-correct"
              @click="openCorrection(data, 'edit')"
            />
            <Button
              v-if="data.soldCount === 0 && data.lostCount === 0 && !data.transfer"
              icon="pi pi-trash"
              severity="danger"
              text
              size="small"
              :aria-label="t('supplier.correction_void')"
              data-testid="delivery-void"
              @click="openCorrection(data, 'void')"
            />
          </div>
        </template>
      </Column>
      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('supplier.deliveries_none') }}
        </div>
      </template>
    </PaginatedDataTable>

    <DeliveryCorrectionDialog
      v-model:visible="correctionVisible"
      :delivery="correctionTarget"
      :mode="correctionMode"
    />
  </AppLayout>
</template>
