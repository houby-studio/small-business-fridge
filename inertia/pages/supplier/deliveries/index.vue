<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Select from 'primevue/select'
import Button from 'primevue/button'
import Column from 'primevue/column'
import { useI18n } from '~/composables/use_i18n'
import { formatDate } from '~/composables/use_format_date'
import { useListFilters } from '~/composables/use_list_filters'
import { useSelectEnterKey } from '~/composables/use_select_enter_key'
import FilterBar from '~/components/FilterBar.vue'
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

interface PaginatedDeliveries {
  data: DeliveryRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
}

const props = defineProps<{
  products: ProductOption[]
  recentDeliveries: PaginatedDeliveries
  filters: { productId: string; sortBy: string; sortOrder: string; scope: string }
  preselect: number | null
}>()

const { t } = useI18n()
const ALL = '__all__'

const filterProductId = ref(props.filters.productId || ALL)
const filterSortBy = ref(props.filters.sortBy || 'createdAt')
const filterSortOrder = ref(props.filters.sortOrder || 'desc')
const filterScope = ref(props.filters.scope === 'store' ? 'store' : 'mine')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const productFilterOptions = computed(() => [
  { label: t('common.all'), value: ALL },
  ...props.products.map((p) => ({ label: p.displayName, value: String(p.id) })),
])

// Same labels and order as the stock page; only the default differs (history = own).
const scopeOptions = computed(() => [
  { label: t('supplier.stock_scope_store'), value: 'store' },
  { label: t('supplier.stock_scope_mine'), value: 'mine' },
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

function buildFilterParams() {
  return {
    productId: filterProductId.value === ALL ? undefined : filterProductId.value,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
    scope: filterScope.value === 'mine' ? undefined : filterScope.value,
  }
}

const { applyFilters, navigateClear, onPageChange, navigateSort } = useListFilters({
  route: '/supplier/deliveries',
  onlyProps: ['recentDeliveries', 'filters'],
  buildParams: buildFilterParams,
  getCurrentPage: () => props.recentDeliveries.meta.currentPage,
})

function clearFilters() {
  filterProductId.value = ALL
  filterSortBy.value = 'createdAt'
  filterSortOrder.value = 'desc'
  filterScope.value = 'mine'
  navigateClear()
}

function onSort(event: any) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  navigateSort()
}

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
    <Head :title="t('supplier.deliveries_title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900 dark:text-zinc-100">
      {{ t('supplier.deliveries_recent') }}
    </h1>

    <div class="mb-4">
      <Button
        :label="t('supplier.deliveries_open_inventory')"
        icon="pi pi-warehouse"
        size="small"
        @click="router.get('/supplier/stock')"
      />
    </div>

    <!-- Filter bar -->
    <FilterBar @apply="applyFilters" @clear="clearFilters">
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('supplier.stock_scope')
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
          t('supplier.deliveries_filter_product')
        }}</label>
        <Select
          ref="productFilterSelect"
          v-model="filterProductId"
          :options="productFilterOptions"
          optionLabel="label"
          optionValue="value"
          :placeholder="t('supplier.deliveries_filter_product')"
          filter
          @show="onSelectShow"
        />
      </div>
    </FilterBar>

    <PaginatedDataTable
      :value="recentDeliveries.data"
      :meta="recentDeliveries.meta"
      :sortField="filterSortBy"
      :sortOrder="sortOrderNum"
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
      <Column v-if="filters.scope === 'store'" :header="t('common.supplier')">
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
        <template #body="{ data }">{{ data.amountLeft }} {{ t('common.pieces') }}</template>
      </Column>
      <Column
        :header="t('common.price')"
        field="price"
        sortable
        headerClass="sbf-col-price"
        bodyClass="sbf-col-price"
      >
        <template #body="{ data }">{{
          t('common.price_with_currency', { price: data.price })
        }}</template>
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
