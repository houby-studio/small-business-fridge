<script setup lang="ts">
import { ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Card from 'primevue/card'
import Select from 'primevue/select'
import Button from 'primevue/button'
import { useI18n } from '~/composables/use_i18n'
import { formatDate } from '~/composables/use_format_date'

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
    totalUnpaid: number
  }
  filters: { channel: string; invoiced: string }
}>()

const { t } = useI18n()

const filterChannel = ref(props.filters.channel)
const filterInvoiced = ref(props.filters.invoiced)

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
    channel: filterChannel.value || undefined,
    invoiced: filterInvoiced.value || undefined,
  }
}

function applyFilters() {
  router.get('/orders', { ...buildFilterParams(), page: 1 }, { preserveState: true })
}

function clearFilters() {
  filterChannel.value = ''
  filterInvoiced.value = ''
  router.get('/orders', {}, { preserveState: true })
}

function onPageChange(event: any) {
  router.get('/orders', { ...buildFilterParams(), page: event.page + 1 }, { preserveState: true })
}

function channelLabel(channel: string) {
  const key = `common.channel_${channel}` as const
  return t(key)
}
</script>

<template>
  <AppLayout>
    <Head :title="t('orders.title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900">{{ t('orders.my_orders') }}</h1>

    <!-- Stats cards -->
    <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card class="text-center">
        <template #content>
          <div class="text-3xl font-bold text-gray-900">{{ stats.totalOrders }}</div>
          <div class="text-sm text-gray-500">{{ t('orders.total_orders') }}</div>
        </template>
      </Card>
      <Card class="text-center">
        <template #content>
          <div class="text-3xl font-bold text-gray-900">
            {{ t('common.price_with_currency', { price: stats.totalSpend }) }}
          </div>
          <div class="text-sm text-gray-500">{{ t('orders.total_spent') }}</div>
        </template>
      </Card>
      <Card class="text-center">
        <template #content>
          <div class="text-3xl font-bold text-red-600">
            {{ t('common.price_with_currency', { price: stats.totalUnpaid }) }}
          </div>
          <div class="text-sm text-gray-500">{{ t('orders.total_unpaid') }}</div>
        </template>
      </Card>
    </div>

    <!-- Filter bar -->
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="mb-1 block text-sm text-gray-600">{{ t('orders.filter_channel') }}</label>
        <Select
          v-model="filterChannel"
          :options="channelOptions"
          optionLabel="label"
          optionValue="value"
          class="w-36"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-600">{{ t('orders.filter_invoiced') }}</label>
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

    <!-- Orders table -->
    <DataTable
      :value="orders.data"
      :paginator="orders.meta.lastPage > 1"
      :rows="orders.meta.perPage"
      :totalRecords="orders.meta.total"
      :lazy="true"
      :first="(orders.meta.currentPage - 1) * orders.meta.perPage"
      @page="onPageChange"
      stripedRows
      class="rounded-lg border"
    >
      <Column :header="t('common.date')">
        <template #body="{ data }">
          {{ formatDate(data.createdAt) }}
        </template>
      </Column>
      <Column :header="t('common.product')">
        <template #body="{ data }">
          {{ data.delivery?.product?.displayName ?? '—' }}
        </template>
      </Column>
      <Column :header="t('common.price')">
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
      <Column :header="t('common.channel')">
        <template #body="{ data }">
          <Tag :value="channelLabel(data.channel)" severity="info" class="text-xs" />
        </template>
      </Column>
      <Column header="#">
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
        <div class="py-8 text-center text-gray-500">
          {{ t('orders.no_orders') }}
        </div>
      </template>
    </DataTable>
  </AppLayout>
</template>
