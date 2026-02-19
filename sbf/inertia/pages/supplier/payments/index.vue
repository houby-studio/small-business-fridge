<script setup lang="ts">
import { ref, computed } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import Select from 'primevue/select'
import { useI18n } from '~/composables/use_i18n'
import { formatDate } from '~/composables/use_format_date'

interface InvoiceRow {
  id: number
  totalCost: number
  isPaid: boolean
  isPaymentRequested: boolean
  createdAt: string
  buyer: { displayName: string }
}

interface PaginatedInvoices {
  data: InvoiceRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
}

const props = defineProps<{
  invoices: PaginatedInvoices
  filters: { status: string; sortBy: string; sortOrder: string; buyerId: string }
  buyers: { id: number; displayName: string }[]
}>()
const { t } = useI18n()

const filterStatus = ref(props.filters.status)
const filterSortBy = ref(props.filters.sortBy || 'createdAt')
const filterSortOrder = ref(props.filters.sortOrder || 'desc')
const filterBuyerId = ref(props.filters.buyerId ? Number(props.filters.buyerId) : null)
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const buyerOptions = [{ id: null, displayName: '—' }, ...props.buyers]

const statusOptions = [
  { label: t('common.all'), value: '' },
  { label: t('invoices.filter_paid'), value: 'paid' },
  { label: t('invoices.filter_unpaid'), value: 'unpaid' },
  { label: t('invoices.filter_awaiting'), value: 'awaiting' },
]

function statusSeverity(invoice: InvoiceRow) {
  if (invoice.isPaid) return 'success'
  if (invoice.isPaymentRequested) return 'warn'
  return 'secondary'
}

function statusLabel(invoice: InvoiceRow) {
  if (invoice.isPaid) return t('common.paid')
  if (invoice.isPaymentRequested) return t('common.awaiting_approval')
  return t('common.unpaid')
}

function approve(id: number) {
  router.post(`/supplier/payments/${id}`, { action: 'approve' })
}

function reject(id: number) {
  router.post(`/supplier/payments/${id}`, { action: 'reject' })
}

function buildFilterParams() {
  return {
    status: filterStatus.value || undefined,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
    buyerId: filterBuyerId.value ?? undefined,
  }
}

function applyFilters() {
  router.get(
    '/supplier/payments',
    { ...buildFilterParams(), page: 1 },
    { preserveState: true, only: ['invoices', 'filters'] }
  )
}

function clearFilters() {
  filterStatus.value = ''
  filterSortBy.value = 'createdAt'
  filterSortOrder.value = 'desc'
  filterBuyerId.value = null
  router.get('/supplier/payments', {}, { preserveState: true, only: ['invoices', 'filters'] })
}

function onPageChange(event: any) {
  router.get(
    '/supplier/payments',
    { ...buildFilterParams(), page: event.page + 1 },
    { preserveState: true, only: ['invoices', 'filters'] }
  )
}

function onSort(event: any) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  router.get(
    '/supplier/payments',
    {
      ...buildFilterParams(),
      sortBy: event.sortField,
      sortOrder: event.sortOrder === 1 ? 'asc' : 'desc',
      page: 1,
    },
    { preserveState: true, only: ['invoices', 'filters'] }
  )
}
</script>

<template>
  <AppLayout>
    <Head :title="t('supplier.payments_title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900">{{ t('supplier.payments_heading') }}</h1>

    <!-- Filter bar -->
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="mb-1 block text-sm text-gray-600">{{
          t('supplier.payments_filter_status')
        }}</label>
        <Select
          v-model="filterStatus"
          :options="statusOptions"
          optionLabel="label"
          optionValue="value"
          class="w-44"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-600">{{
          t('supplier.payments_filter_customer')
        }}</label>
        <Select
          v-model="filterBuyerId"
          :options="buyerOptions"
          optionLabel="displayName"
          optionValue="id"
          filter
          class="w-48"
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
      :value="invoices.data"
      :paginator="invoices.meta.lastPage > 1"
      :rows="invoices.meta.perPage"
      :totalRecords="invoices.meta.total"
      :lazy="true"
      :first="(invoices.meta.currentPage - 1) * invoices.meta.perPage"
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
      <Column :header="t('common.total')" field="totalCost" sortable style="width: 120px">
        <template #body="{ data }">
          <span class="font-semibold">{{
            t('common.price_with_currency', { price: data.totalCost })
          }}</span>
        </template>
      </Column>
      <Column :header="t('common.status')">
        <template #body="{ data }">
          <Tag :value="statusLabel(data)" :severity="statusSeverity(data)" class="text-xs" />
        </template>
      </Column>
      <Column :header="t('common.actions')" style="width: 220px">
        <template #body="{ data }">
          <div class="flex gap-1">
            <Button
              v-if="!data.isPaid"
              :label="t('supplier.payments_approve')"
              icon="pi pi-check"
              size="small"
              severity="success"
              @click="approve(data.id)"
            />
            <Button
              v-if="data.isPaymentRequested && !data.isPaid"
              :label="t('supplier.payments_reject')"
              icon="pi pi-times"
              size="small"
              severity="danger"
              outlined
              @click="reject(data.id)"
            />
            <Tag
              v-if="data.isPaid"
              :value="t('common.approved')"
              severity="success"
              class="text-xs"
            />
          </div>
        </template>
      </Column>

      <template #empty>
        <div class="py-8 text-center text-gray-500">{{ t('supplier.payments_no_invoices') }}</div>
      </template>
    </DataTable>
  </AppLayout>
</template>
