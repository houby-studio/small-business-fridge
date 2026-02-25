<script setup lang="ts">
import { ref, computed } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Select from 'primevue/select'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import { useI18n } from '~/composables/use_i18n'
import { formatDate } from '~/composables/use_format_date'
import { areFilterParamsEqual } from '~/composables/use_filter_params'

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
  product: { displayName: string; category?: { name: string } }
}

interface PaginatedDeliveries {
  data: DeliveryRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
}

const props = defineProps<{
  products: ProductOption[]
  recentDeliveries: PaginatedDeliveries
  filters: { productId: string; sortBy: string; sortOrder: string }
  preselect: number | null
}>()

const { t } = useI18n()
const ALL = '__all__'

const filterProductId = ref(props.filters.productId || ALL)
const filterSortBy = ref(props.filters.sortBy || 'createdAt')
const filterSortOrder = ref(props.filters.sortOrder || 'desc')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const productFilterOptions = computed(() => [
  { label: t('common.all'), value: ALL },
  ...props.products.map((p) => ({ label: p.displayName, value: String(p.id) })),
])

function buildFilterParams() {
  return {
    productId: filterProductId.value === ALL ? undefined : filterProductId.value,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
  }
}

const lastAppliedFilterParams = ref(buildFilterParams())

function applyFilters() {
  const nextParams = buildFilterParams()
  const page = areFilterParamsEqual(nextParams, lastAppliedFilterParams.value)
    ? props.recentDeliveries.meta.currentPage
    : 1
  router.get(
    '/supplier/deliveries',
    { ...nextParams, page },
    { preserveState: true, only: ['recentDeliveries', 'filters'] }
  )
  lastAppliedFilterParams.value = nextParams
}

function clearFilters() {
  filterProductId.value = ALL
  filterSortBy.value = 'createdAt'
  filterSortOrder.value = 'desc'
  lastAppliedFilterParams.value = buildFilterParams()
  router.get('/supplier/deliveries', buildFilterParams(), {
    preserveState: true,
    only: ['recentDeliveries', 'filters'],
  })
}

function onPageChange(event: any) {
  router.get(
    '/supplier/deliveries',
    { ...buildFilterParams(), page: event.page + 1 },
    { preserveState: true, only: ['recentDeliveries', 'filters'] }
  )
}

function onSort(event: any) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  router.get(
    '/supplier/deliveries',
    {
      ...buildFilterParams(),
      sortBy: event.sortField,
      sortOrder: event.sortOrder === 1 ? 'asc' : 'desc',
      page: 1,
    },
    { preserveState: true, only: ['recentDeliveries', 'filters'] }
  )
}
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
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('supplier.deliveries_filter_product')
        }}</label>
        <Select
          v-model="filterProductId"
          :options="productFilterOptions"
          optionLabel="label"
          optionValue="value"
          :placeholder="t('supplier.deliveries_filter_product')"
          filter
        />
      </div>
      <Button
        :label="t('common.filter_apply')"
        icon="pi pi-filter"
        size="small"
        @click="applyFilters"
      />
      <Button
        :label="t('common.filter_clear')"
        size="small"
        severity="secondary"
        text
        @click="clearFilters"
      />
    </div>

    <DataTable
      :value="recentDeliveries.data"
      :paginator="recentDeliveries.meta.lastPage > 1"
      :rows="recentDeliveries.meta.perPage"
      :totalRecords="recentDeliveries.meta.total"
      :lazy="true"
      :first="(recentDeliveries.meta.currentPage - 1) * recentDeliveries.meta.perPage"
      :sortField="filterSortBy"
      :sortOrder="sortOrderNum"
      @page="onPageChange"
      @sort="onSort"
      stripedRows
      class="rounded-lg border"
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
        <template #body="{ data }">{{ data.product?.displayName ?? '—' }}</template>
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

      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('supplier.deliveries_none') }}
        </div>
      </template>
    </DataTable>
  </AppLayout>
</template>
