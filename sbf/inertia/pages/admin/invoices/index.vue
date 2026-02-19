<script setup lang="ts">
import { ref, computed } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Select from 'primevue/select'
import Button from 'primevue/button'
import { useI18n } from '~/composables/use_i18n'
import { formatDate } from '~/composables/use_format_date'

interface InvoiceRow {
  id: number
  totalCost: number
  isPaid: boolean
  isPaymentRequested: boolean
  createdAt: string
  buyer: { displayName: string }
  supplier: { displayName: string }
}

interface PaginatedInvoices {
  data: InvoiceRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
}

const props = defineProps<{
  invoices: PaginatedInvoices
  filters: { status: string; sortBy: string; sortOrder: string }
}>()
const { t } = useI18n()

const filterStatus = ref(props.filters.status)
const filterSortBy = ref(props.filters.sortBy || 'createdAt')
const filterSortOrder = ref(props.filters.sortOrder || 'desc')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const statusOptions = [
  { label: t('common.all'), value: '' },
  { label: t('invoices.filter_paid'), value: 'paid' },
  { label: t('invoices.filter_unpaid'), value: 'unpaid' },
  { label: t('invoices.filter_awaiting'), value: 'awaiting' },
]

function statusSeverity(inv: InvoiceRow) {
  if (inv.isPaid) return 'success'
  if (inv.isPaymentRequested) return 'warn'
  return 'secondary'
}

function statusLabel(inv: InvoiceRow) {
  if (inv.isPaid) return t('common.paid')
  if (inv.isPaymentRequested) return t('common.awaiting_approval')
  return t('common.unpaid')
}

function buildFilterParams() {
  return {
    status: filterStatus.value || undefined,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
  }
}

function applyFilters() {
  router.get(
    '/admin/invoices',
    { ...buildFilterParams(), page: 1 },
    { preserveState: true, only: ['invoices', 'filters'] }
  )
}

function clearFilters() {
  filterStatus.value = ''
  filterSortBy.value = 'createdAt'
  filterSortOrder.value = 'desc'
  router.get('/admin/invoices', {}, { preserveState: true, only: ['invoices', 'filters'] })
}

function onPageChange(event: any) {
  router.get(
    '/admin/invoices',
    { ...buildFilterParams(), page: event.page + 1 },
    { preserveState: true, only: ['invoices', 'filters'] }
  )
}

function onSort(event: any) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  router.get(
    '/admin/invoices',
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
    <Head :title="t('admin.invoices_title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900">{{ t('admin.invoices_heading') }}</h1>

    <!-- Filter bar -->
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="mb-1 block text-sm text-gray-600">{{
          t('admin.invoices_filter_status')
        }}</label>
        <Select
          v-model="filterStatus"
          :options="statusOptions"
          optionLabel="label"
          optionValue="value"
          class="w-44"
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
      <Column :header="t('common.supplier')">
        <template #body="{ data }">{{ data.supplier?.displayName ?? '—' }}</template>
      </Column>
      <Column :header="t('common.total')" field="totalCost" sortable style="width: 100px">
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

      <template #empty>
        <div class="py-8 text-center text-gray-500">{{ t('admin.invoices_no_invoices') }}</div>
      </template>
    </DataTable>
  </AppLayout>
</template>
