<script setup lang="ts">
import { ref, computed } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import Select from 'primevue/select'
import InputText from 'primevue/inputtext'
import ConfirmDialog from 'primevue/confirmdialog'
import { useConfirm } from 'primevue/useconfirm'
import { useI18n } from '~/composables/use_i18n'
import { formatDate } from '~/composables/use_format_date'

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
  filters: { search: string; channel: string; invoiced: string; sortBy: string; sortOrder: string }
}>()
const confirm = useConfirm()
const { t } = useI18n()

const filterSearch = ref(props.filters.search)
const filterChannel = ref(props.filters.channel)
const filterInvoiced = ref(props.filters.invoiced)
const filterSortBy = ref(props.filters.sortBy || 'createdAt')
const filterSortOrder = ref(props.filters.sortOrder || 'desc')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const channelOptions = [
  { label: t('common.all'), value: '' },
  { label: t('common.channel_web'), value: 'web' },
  { label: t('common.channel_keypad'), value: 'keypad' },
  { label: t('common.channel_scanner'), value: 'scanner' },
]

const invoicedOptions = [
  { label: t('common.all'), value: '' },
  { label: t('orders.filter_invoiced_yes'), value: 'yes' },
  { label: t('orders.filter_invoiced_no'), value: 'no' },
]

function buildFilterParams() {
  return {
    search: filterSearch.value || undefined,
    channel: filterChannel.value || undefined,
    invoiced: filterInvoiced.value || undefined,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
  }
}

function applyFilters() {
  router.get(
    '/admin/orders',
    { ...buildFilterParams(), page: 1 },
    { preserveState: true, only: ['orders', 'filters'] }
  )
}

function clearFilters() {
  filterSearch.value = ''
  filterChannel.value = ''
  filterInvoiced.value = ''
  filterSortBy.value = 'createdAt'
  filterSortOrder.value = 'desc'
  router.get('/admin/orders', {}, { preserveState: true, only: ['orders', 'filters'] })
}

function onPageChange(event: any) {
  router.get(
    '/admin/orders',
    { ...buildFilterParams(), page: event.page + 1 },
    { preserveState: true, only: ['orders', 'filters'] }
  )
}

function onSort(event: any) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  router.get(
    '/admin/orders',
    {
      ...buildFilterParams(),
      sortBy: event.sortField,
      sortOrder: event.sortOrder === 1 ? 'asc' : 'desc',
      page: 1,
    },
    { preserveState: true, only: ['orders', 'filters'] }
  )
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

    <h1 class="mb-6 text-2xl font-bold text-gray-900">{{ t('admin.orders_heading') }}</h1>

    <!-- Filter bar -->
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="mb-1 block text-sm text-gray-600">{{
          t('admin.orders_filter_search')
        }}</label>
        <InputText v-model="filterSearch" class="w-48" @keydown.enter="applyFilters" />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-600">{{
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
        <label class="mb-1 block text-sm text-gray-600">{{
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
      :value="orders.data"
      :paginator="orders.meta.lastPage > 1"
      :rows="orders.meta.perPage"
      :totalRecords="orders.meta.total"
      :lazy="true"
      :first="(orders.meta.currentPage - 1) * orders.meta.perPage"
      :sortField="filterSortBy"
      :sortOrder="sortOrderNum"
      @page="onPageChange"
      @sort="onSort"
      stripedRows
      class="rounded-lg border"
    >
      <Column header="#" style="width: 60px">
        <template #body="{ data }">{{ data.id }}</template>
      </Column>
      <Column :header="t('common.date')" field="createdAt" sortable>
        <template #body="{ data }">{{ formatDate(data.createdAt) }}</template>
      </Column>
      <Column :header="t('common.customer')">
        <template #body="{ data }">{{ data.buyer?.displayName ?? '—' }}</template>
      </Column>
      <Column :header="t('common.product')">
        <template #body="{ data }">{{ data.delivery?.product?.displayName ?? '—' }}</template>
      </Column>
      <Column :header="t('common.price')" style="width: 80px">
        <template #body="{ data }">{{
          t('common.price_with_currency', { price: data.delivery?.price ?? 0 })
        }}</template>
      </Column>
      <Column :header="t('common.supplier')">
        <template #body="{ data }">{{ data.delivery?.supplier?.displayName ?? '—' }}</template>
      </Column>
      <Column :header="t('common.channel')" style="width: 90px">
        <template #body="{ data }">
          <Tag :value="t(`common.channel_${data.channel}`)" severity="info" class="text-xs" />
        </template>
      </Column>
      <Column :header="t('admin.orders_invoice')" style="width: 90px">
        <template #body="{ data }">
          <Tag
            v-if="data.invoiceId"
            :value="`#${data.invoiceId}`"
            severity="success"
            class="text-xs"
          />
          <span v-else class="text-xs text-gray-400">—</span>
        </template>
      </Column>
      <Column :header="t('common.actions')" style="width: 100px">
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
        <div class="py-8 text-center text-gray-500">{{ t('admin.orders_no_orders') }}</div>
      </template>
    </DataTable>
  </AppLayout>
</template>
