<script setup lang="ts">
import { ref, computed } from 'vue'
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
  navigateClear()
}

function onSort(event: any) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  navigateSort()
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
    <FilterBar @apply="applyFilters" @clear="clearFilters">
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
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
    </PaginatedDataTable>
  </AppLayout>
</template>
