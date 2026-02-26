<script setup lang="ts">
import { ref, computed } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import Select from 'primevue/select'
import ConfirmDialog from 'primevue/confirmdialog'
import { useConfirm } from 'primevue/useconfirm'
import { useI18n } from '~/composables/use_i18n'
import { formatDate } from '~/composables/use_format_date'
import { useListFilters } from '~/composables/use_list_filters'
import { useSelectEnterKey } from '~/composables/use_select_enter_key'
import FilterBar from '~/components/FilterBar.vue'
import PaginatedDataTable from '~/components/PaginatedDataTable.vue'

interface OrderRow {
  id: number
  channel: string
  createdAt: string
  invoiceId: number | null
  buyer: { displayName: string }
  delivery: {
    price: number
    product: { displayName: string }
    supplier: { displayName: string }
  }
}

interface PaginatedOrders {
  data: OrderRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
}

const props = defineProps<{
  orders: PaginatedOrders
  filters: {
    channel: string
    invoiced: string
    buyerId: string
    supplierId: string
    sortBy: string
    sortOrder: string
  }
  buyers: { id: number; displayName: string }[]
  suppliers: { id: number; displayName: string }[]
}>()
const confirm = useConfirm()
const { t } = useI18n()
const ALL = '__all__'

const filterChannel = ref(props.filters.channel || ALL)
const filterInvoiced = ref(props.filters.invoiced || ALL)
const filterBuyerId = ref<number | string>(
  props.filters.buyerId ? Number(props.filters.buyerId) : ALL
)
const filterSupplierId = ref<number | string>(
  props.filters.supplierId ? Number(props.filters.supplierId) : ALL
)
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
const buyerOptions = computed(() => [{ id: ALL, displayName: t('common.all') }, ...props.buyers])
const supplierOptions = computed(() => [
  { id: ALL, displayName: t('common.all') },
  ...props.suppliers,
])
const buyerFilterSelect = ref<any>(null)
const supplierFilterSelect = ref<any>(null)

const { onSelectShow } = useSelectEnterKey([
  {
    selectRef: buyerFilterSelect,
    getOptions: () => buyerOptions.value,
    getLabel: (o) => o.displayName,
    getValue: (o) => o.id,
    onSelect: (v) => {
      filterBuyerId.value = v
    },
  },
  {
    selectRef: supplierFilterSelect,
    getOptions: () => supplierOptions.value,
    getLabel: (o) => o.displayName,
    getValue: (o) => o.id,
    onSelect: (v) => {
      filterSupplierId.value = v
    },
  },
])

function buildFilterParams() {
  return {
    channel: filterChannel.value === ALL ? undefined : filterChannel.value,
    invoiced: filterInvoiced.value === ALL ? undefined : filterInvoiced.value,
    buyerId: filterBuyerId.value === ALL ? undefined : filterBuyerId.value,
    supplierId: filterSupplierId.value === ALL ? undefined : filterSupplierId.value,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
  }
}

const { applyFilters, navigateClear, onPageChange, navigateSort } = useListFilters({
  route: '/admin/orders',
  onlyProps: ['orders', 'filters'],
  buildParams: buildFilterParams,
  getCurrentPage: () => props.orders.meta.currentPage,
})

function clearFilters() {
  filterChannel.value = ALL
  filterInvoiced.value = ALL
  filterBuyerId.value = ALL
  filterSupplierId.value = ALL
  filterSortBy.value = 'createdAt'
  filterSortOrder.value = 'desc'
  navigateClear()
}

function onSort(event: any) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  navigateSort()
}

function storno(orderId: number) {
  confirm.require({
    message: t('admin.orders_storno_confirm', { id: orderId }),
    header: t('admin.orders_storno_header'),
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: t('admin.orders_storno_accept'),
    rejectLabel: t('common.cancel'),
    acceptClass: 'p-button-danger',
    accept: () => {
      router.post(`/admin/storno/${orderId}`)
    },
  })
}
</script>

<template>
  <AppLayout>
    <Head :title="t('admin.orders_title')" />
    <ConfirmDialog />

    <h1 class="mb-6 text-2xl font-bold text-gray-900 dark:text-zinc-100">
      {{ t('admin.orders_heading') }}
    </h1>

    <!-- Filter bar -->
    <FilterBar @apply="applyFilters" @clear="clearFilters">
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('admin.orders_filter_channel')
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
          t('admin.orders_filter_invoiced')
        }}</label>
        <Select
          v-model="filterInvoiced"
          :options="invoicedOptions"
          optionLabel="label"
          optionValue="value"
          class="w-36"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('admin.orders_filter_customer')
        }}</label>
        <Select
          ref="buyerFilterSelect"
          v-model="filterBuyerId"
          :options="buyerOptions"
          optionLabel="displayName"
          optionValue="id"
          filter
          class="w-56"
          @show="onSelectShow"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('admin.orders_filter_supplier')
        }}</label>
        <Select
          ref="supplierFilterSelect"
          v-model="filterSupplierId"
          :options="supplierOptions"
          optionLabel="displayName"
          optionValue="id"
          filter
          class="w-56"
          @show="onSelectShow"
        />
      </div>
    </FilterBar>

    <PaginatedDataTable
      :value="orders.data"
      :meta="orders.meta"
      :sortField="filterSortBy"
      :sortOrder="sortOrderNum"
      @page="onPageChange"
      @sort="onSort"
    >
      <Column header="#" headerClass="sbf-col-id" bodyClass="sbf-col-id">
        <template #body="{ data }">{{ data.id }}</template>
      </Column>
      <Column
        :header="t('common.date')"
        field="createdAt"
        sortable
        headerClass="sbf-col-date"
        bodyClass="sbf-col-date"
      >
        <template #body="{ data }">{{ formatDate(data.createdAt) }}</template>
      </Column>
      <Column :header="t('common.customer')">
        <template #body="{ data }">{{ data.buyer?.displayName ?? '—' }}</template>
      </Column>
      <Column :header="t('common.product')">
        <template #body="{ data }">{{ data.delivery?.product?.displayName ?? '—' }}</template>
      </Column>
      <Column :header="t('common.price')" headerClass="sbf-col-price" bodyClass="sbf-col-price">
        <template #body="{ data }">{{
          t('common.price_with_currency', { price: data.delivery?.price ?? 0 })
        }}</template>
      </Column>
      <Column :header="t('common.supplier')">
        <template #body="{ data }">{{ data.delivery?.supplier?.displayName ?? '—' }}</template>
      </Column>
      <Column :header="t('common.channel')" headerClass="sbf-col-tight" bodyClass="sbf-col-tight">
        <template #body="{ data }">
          <Tag :value="t(`common.channel_${data.channel}`)" severity="info" class="text-xs" />
        </template>
      </Column>
      <Column
        :header="t('admin.orders_invoice')"
        headerClass="sbf-col-tight"
        bodyClass="sbf-col-tight"
      >
        <template #body="{ data }">
          <Tag
            v-if="data.invoiceId"
            :value="`#${data.invoiceId}`"
            severity="success"
            class="text-xs"
          />
          <span v-else class="text-xs text-gray-400 dark:text-zinc-500">—</span>
        </template>
      </Column>
      <Column :header="t('common.actions')" headerClass="sbf-col-action" bodyClass="sbf-col-action">
        <template #body="{ data }">
          <Button
            v-if="!data.invoiceId"
            icon="pi pi-trash"
            size="small"
            severity="danger"
            text
            @click="storno(data.id)"
            :aria-label="t('admin.orders_storno')"
          />
        </template>
      </Column>

      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('admin.orders_no_orders') }}
        </div>
      </template>
    </PaginatedDataTable>
  </AppLayout>
</template>
