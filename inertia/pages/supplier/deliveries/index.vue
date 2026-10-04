<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Head, Link } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Select from 'primevue/select'
import Button from 'primevue/button'
import Column from 'primevue/column'
import { useI18n } from '~/composables/use_i18n'
import { formatDate } from '~/composables/use_format_date'
import { useListFilters } from '~/composables/use_list_filters'
import { useSelectEnterKey } from '~/composables/use_select_enter_key'
import { useMoney } from '~/composables/use_pricing'
import FilterBar from '~/components/FilterBar.vue'
import PageTabs from '~/components/PageTabs.vue'
import PaginatedDataTable from '~/components/PaginatedDataTable.vue'
import DeliveryCorrectionDialog from '~/components/DeliveryCorrectionDialog.vue'
import type { CorrectableDelivery } from '~/components/DeliveryCorrectionDialog.vue'

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
  lastCorrection: { reason: string; createdAt: string } | null
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
}

interface PageMeta {
  total: number
  perPage: number
  currentPage: number
  lastPage: number
}

type HistoryType = 'deliveries' | 'adjustments'
type HistoryScope = 'all' | 'mine'

const props = defineProps<{
  products: ProductOption[]
  recentDeliveries: { data: DeliveryRow[]; meta: PageMeta }
  adjustments: { data: AdjustmentRow[]; meta: PageMeta }
  filters: {
    productId: string
    sortBy: string
    sortOrder: string
    scope: HistoryScope
    type: HistoryType
  }
}>()

const { t } = useI18n()
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

const filterType = ref<HistoryType>(
  props.filters.type === 'adjustments' ? 'adjustments' : 'deliveries'
)
const filterScope = ref<HistoryScope>(props.filters.scope === 'all' ? 'all' : 'mine')
const filterProductId = ref(props.filters.productId || ALL)
const filterSortBy = ref(props.filters.sortBy || 'createdAt')
const filterSortOrder = ref(props.filters.sortOrder || 'desc')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const showAdjustments = computed(() => props.filters.type === 'adjustments')
const meta = computed(() =>
  showAdjustments.value ? props.adjustments.meta : props.recentDeliveries.meta
)

const typeOptions = computed(() => [
  { label: t('supplier.history_type_deliveries'), value: 'deliveries' },
  { label: t('supplier.history_type_adjustments'), value: 'adjustments' },
])
// Same labels and order as the stock page; only the default differs (history = own).
const scopeOptions = computed(() => [
  { label: t('common.scope_all'), value: 'all' },
  { label: t('common.scope_mine'), value: 'mine' },
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
watch(filterType, () => {
  filterSortBy.value = 'createdAt'
  filterSortOrder.value = 'desc'
})

function buildFilterParams() {
  return {
    type: filterType.value === 'deliveries' ? undefined : filterType.value,
    scope: filterScope.value === 'mine' ? undefined : filterScope.value,
    productId: filterProductId.value === ALL ? undefined : filterProductId.value,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
  }
}

const { applyFilters, navigateClear, onPageChange, navigateSort } = useListFilters({
  route: '/supplier/deliveries',
  onlyProps: ['recentDeliveries', 'adjustments', 'filters'],
  buildParams: buildFilterParams,
  getCurrentPage: () => meta.value.currentPage,
})

function clearFilters() {
  filterType.value = 'deliveries'
  filterScope.value = 'mine'
  filterProductId.value = ALL
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
    <Head :title="`${t('supplier.stock_title')} · ${t('common.tab_stock_history')}`" />

    <h1 class="mb-3 text-2xl font-bold text-gray-900 dark:text-zinc-100">
      {{ t('supplier.stock_title') }}
    </h1>
    <PageTabs :tabs="tabs" />

    <FilterBar @apply="applyFilters" @clear="clearFilters">
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
        />
      </div>
      <div>
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
      @page="onPageChange"
      @sort="onSort"
    >
      <Column
        :header="t('common.date')"
        field="createdAt"
        sortable
        headerClass="sbf-col-date"
        bodyClass="sbf-col-date"
      >
        <template #body="{ data }">{{ formatDate(data.createdAt) }}</template>
      </Column>
      <Column :header="t('common.product')" field="productName" sortable>
        <template #body="{ data }">{{ data.productName }}</template>
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
            :class="
              data.kind === 'surplus'
                ? 'text-green-700 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            "
            data-testid="adjustment-quantity"
            >{{ data.kind === 'surplus' ? '+' : '−' }}{{ data.quantity }}
            {{ t('common.pieces') }}</span
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
      <Column v-if="filters.scope === 'all'" :header="t('supplier.history_lot_supplier')">
        <template #body="{ data }">{{ data.lotSupplierName }}</template>
      </Column>
      <Column :header="t('supplier.history_actor')">
        <template #body="{ data }">{{ data.actorName }}</template>
      </Column>
      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('supplier.history_adjustments_none') }}
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
      data-testid="history-deliveries"
      @page="onPageChange"
      @sort="onSort"
    >
      <Column
        :header="t('common.date')"
        field="createdAt"
        sortable
        headerClass="sbf-col-date"
        bodyClass="sbf-col-date"
      >
        <template #body="{ data }">{{ formatDate(data.createdAt) }}</template>
      </Column>
      <Column :header="t('common.product')">
        <template #body="{ data }">
          <div>{{ data.product?.displayName ?? '—' }}</div>
          <div
            v-if="data.lastCorrection"
            class="text-xs text-gray-500 dark:text-zinc-400"
            data-testid="delivery-last-correction"
          >
            {{
              t('supplier.deliveries_last_correction', {
                date: formatDate(data.lastCorrection.createdAt),
                reason: data.lastCorrection.reason,
              })
            }}
          </div>
        </template>
      </Column>
      <Column v-if="filters.scope === 'all'" :header="t('common.supplier')">
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
        headerClass="sbf-col-number"
        bodyClass="sbf-col-number"
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
        </template>
      </Column>
      <Column
        :header="t('common.price')"
        field="price"
        sortable
        headerClass="sbf-col-price"
        bodyClass="sbf-col-price"
      >
        <template #body="{ data }">
          <div>{{ t('common.price_with_currency', { price: data.price }) }}</div>
          <div v-if="data.purchasePrice !== null" class="text-xs text-gray-500 dark:text-zinc-400">
            {{ t('supplier.deliveries_purchase_short', { price: money(data.purchasePrice) }) }}
          </div>
        </template>
      </Column>
      <Column :header="t('common.status')">
        <template #body="{ data }">
          <span
            v-if="data.voidedAt"
            class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-zinc-700 dark:text-zinc-200"
            data-testid="delivery-status-voided"
            >{{ t('supplier.deliveries_status_voided') }}</span
          >
          <span
            v-else-if="data.correctionCount > 0"
            class="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-200"
            data-testid="delivery-status-corrected"
            >{{ t('supplier.deliveries_status_corrected') }}</span
          >
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
              v-if="data.soldCount === 0"
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
