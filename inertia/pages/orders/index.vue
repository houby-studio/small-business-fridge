<script setup lang="ts">
import { ref, computed } from 'vue'
import { Head } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Card from 'primevue/card'
import Select from 'primevue/select'
import { useI18n } from '~/composables/use_i18n'
import { formatDate } from '~/composables/use_format_date'
import { useListFilters } from '~/composables/use_list_filters'
import FilterBar from '~/components/FilterBar.vue'
import PaginatedDataTable from '~/components/PaginatedDataTable.vue'

interface OrderRow {
  id: number
  channel: string
  createdAt: string
  delivery: {
    price: number
    product: { displayName: string }
    supplier: { displayName: string }
  }
  invoiceId: number | null
}

interface PaginatedOrders {
  data: OrderRow[]
  meta: {
    total: number
    perPage: number
    currentPage: number
    lastPage: number
  }
}

const props = defineProps<{
  orders: PaginatedOrders
  stats: {
    totalOrders: number
    totalSpend: number
    totalUninvoiced: number
    filteredOrders: number
    filteredSpend: number
    filteredUninvoiced: number
    filtersApplied: boolean
  }
  filters: { channel: string; invoiced: string; sortBy: string; sortOrder: string }
}>()

const { t } = useI18n()
const ALL = '__all__'

const filterChannel = ref(props.filters.channel || ALL)
const filterInvoiced = ref(props.filters.invoiced || ALL)
const filterSortBy = ref(props.filters.sortBy || 'createdAt')
const filterSortOrder = ref(props.filters.sortOrder || 'desc')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const channelOptions = [
  { label: t('common.all'), value: ALL },
  { label: t('common.channel_web'), value: 'web' },
  { label: t('common.channel_kiosk'), value: 'kiosk' },
  { label: t('common.channel_scanner'), value: 'scanner' },
]

const invoicedOptions = [
  { label: t('common.all'), value: ALL },
  { label: t('orders.filter_invoiced_yes'), value: 'yes' },
  { label: t('orders.filter_invoiced_no'), value: 'no' },
]

function buildFilterParams() {
  return {
    channel: filterChannel.value === ALL ? undefined : filterChannel.value,
    invoiced: filterInvoiced.value === ALL ? undefined : filterInvoiced.value,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
  }
}

const { applyFilters, navigateClear, onPageChange, navigateSort } = useListFilters({
  route: '/orders',
  onlyProps: ['orders', 'filters', 'stats'],
  buildParams: buildFilterParams,
  getCurrentPage: () => props.orders.meta.currentPage,
})

function clearFilters() {
  filterChannel.value = ALL
  filterInvoiced.value = ALL
  filterSortBy.value = 'createdAt'
  filterSortOrder.value = 'desc'
  navigateClear()
}

function onSort(event: any) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  navigateSort()
}

function channelLabel(channel: string) {
  const key = `common.channel_${channel}` as const
  return t(key)
}
</script>

<template>
  <AppLayout>
    <Head :title="t('orders.title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900 dark:text-zinc-100">
      {{ t('orders.my_orders') }}
    </h1>

    <!-- Stats cards -->
    <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card class="sbf-stat sbf-stat-primary">
        <template #content>
          <div class="flex items-center gap-4">
            <div
              class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-red-100 dark:bg-red-950/40"
            >
              <span class="pi pi-list text-xl text-primary" />
            </div>
            <div>
              <div class="text-3xl font-bold text-gray-900 dark:text-zinc-100">
                {{ stats.totalOrders }}
                <span
                  v-if="stats.filtersApplied"
                  class="ml-2 inline-flex items-center gap-1 align-middle text-sm font-semibold text-gray-500 dark:text-zinc-400"
                >
                  <span class="pi pi-filter text-xs" />
                  {{ stats.filteredOrders }}
                </span>
              </div>
              <div class="text-sm text-gray-500 dark:text-zinc-400">
                {{ t('orders.total_orders') }}
              </div>
            </div>
          </div>
        </template>
      </Card>

      <Card class="sbf-stat sbf-stat-green">
        <template #content>
          <div class="flex items-center gap-4">
            <div
              class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-green-100 dark:bg-green-950/40"
            >
              <span class="pi pi-wallet text-xl text-green-600 dark:text-green-400" />
            </div>
            <div>
              <div class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
                {{ t('common.price_with_currency', { price: stats.totalSpend }) }}
                <span
                  v-if="stats.filtersApplied"
                  class="ml-2 inline-flex items-center gap-1 align-middle text-sm font-semibold text-gray-500 dark:text-zinc-400"
                >
                  <span class="pi pi-filter text-xs" />
                  {{ t('common.price_with_currency', { price: stats.filteredSpend }) }}
                </span>
              </div>
              <div class="text-sm text-gray-500 dark:text-zinc-400">
                {{ t('orders.total_spent') }}
              </div>
            </div>
          </div>
        </template>
      </Card>

      <Card class="sbf-stat sbf-stat-red">
        <template #content>
          <div class="flex items-center gap-4">
            <div
              class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-red-100 dark:bg-red-950/40"
            >
              <span class="pi pi-credit-card text-xl text-red-600 dark:text-red-400" />
            </div>
            <div>
              <div class="text-2xl font-bold text-red-600">
                {{ t('common.price_with_currency', { price: stats.totalUninvoiced }) }}
                <span
                  v-if="stats.filtersApplied"
                  class="ml-2 inline-flex items-center gap-1 align-middle text-sm font-semibold text-gray-500 dark:text-zinc-400"
                >
                  <span class="pi pi-filter text-xs" />
                  {{ t('common.price_with_currency', { price: stats.filteredUninvoiced }) }}
                </span>
              </div>
              <div class="text-sm text-gray-500 dark:text-zinc-400">
                {{ t('orders.total_uninvoiced') }}
              </div>
            </div>
          </div>
        </template>
      </Card>
    </div>

    <!-- Filter bar -->
    <FilterBar @apply="applyFilters" @clear="clearFilters">
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('orders.filter_channel')
        }}</label>
        <Select
          v-model="filterChannel"
          :options="channelOptions"
          optionLabel="label"
          optionValue="value"
          class="w-36"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('orders.filter_invoiced')
        }}</label>
        <Select
          v-model="filterInvoiced"
          :options="invoicedOptions"
          optionLabel="label"
          optionValue="value"
          class="w-36"
        />
      </div>
    </FilterBar>

    <!-- Orders table -->
    <PaginatedDataTable
      :value="orders.data"
      :meta="orders.meta"
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
        <template #body="{ data }">
          {{ formatDate(data.createdAt) }}
        </template>
      </Column>
      <Column :header="t('common.product')">
        <template #body="{ data }">
          {{ data.delivery?.product?.displayName ?? '—' }}
        </template>
      </Column>
      <Column :header="t('common.price')" headerClass="sbf-col-price" bodyClass="sbf-col-price">
        <template #body="{ data }">
          <span class="font-semibold">{{
            t('common.price_with_currency', { price: data.delivery?.price ?? '—' })
          }}</span>
        </template>
      </Column>
      <Column :header="t('common.supplier')">
        <template #body="{ data }">
          {{ data.delivery?.supplier?.displayName ?? '—' }}
        </template>
      </Column>
      <Column :header="t('common.channel')" headerClass="sbf-col-tight" bodyClass="sbf-col-tight">
        <template #body="{ data }">
          <Tag :value="channelLabel(data.channel)" severity="info" class="text-xs" />
        </template>
      </Column>
      <Column header="#" headerClass="sbf-col-tight" bodyClass="sbf-col-tight">
        <template #body="{ data }">
          <Tag
            v-if="data.invoiceId"
            :value="'#' + data.invoiceId"
            severity="success"
            class="text-xs"
          />
          <Tag v-else :value="t('common.not_invoiced')" severity="warn" class="text-xs" />
        </template>
      </Column>

      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('orders.no_orders') }}
        </div>
      </template>
    </PaginatedDataTable>
  </AppLayout>
</template>
