<script setup lang="ts">
import { ref, computed } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import Select from 'primevue/select'
import Dialog from 'primevue/dialog'
import { useI18n } from '~/composables/use_i18n'
import { formatDate } from '~/composables/use_format_date'

interface InvoiceOrder {
  id: number
  createdAt: string
  delivery: { price: number; product: { displayName: string } }
}

interface InvoiceRow {
  id: number
  totalCost: number
  isPaid: boolean
  isPaymentRequested: boolean
  createdAt: string
  supplier: { displayName: string; iban: string | null }
  orders: InvoiceOrder[]
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

const qrDialog = ref(false)
const qrImage = ref('')
const qrCode = ref('')
const qrLoading = ref(false)

function statusSeverity(invoice: InvoiceRow) {
  if (invoice.isPaid) return 'success'
  if (invoice.isPaymentRequested) return 'info'
  return 'warn'
}

function statusLabel(invoice: InvoiceRow) {
  if (invoice.isPaid) return t('common.paid')
  if (invoice.isPaymentRequested) return t('common.payment_review')
  return t('common.unpaid')
}

function requestPaid(id: number) {
  router.post(`/invoices/${id}/request-paid`)
}

function cancelPaid(id: number) {
  router.post(`/invoices/${id}/cancel-paid`)
}

async function showQr(id: number) {
  qrLoading.value = true
  qrDialog.value = true
  try {
    const res = await fetch(`/invoices/${id}/qrcode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-XSRF-TOKEN': decodeURIComponent(document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] || ''),
      },
    })
    const data = await res.json()
    qrImage.value = data.imageData || ''
    qrCode.value = data.code || ''
  } catch {
    qrImage.value = ''
    qrCode.value = t('invoices.qr_error')
  } finally {
    qrLoading.value = false
  }
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
    '/invoices',
    { ...buildFilterParams(), page: 1 },
    { preserveState: true, only: ['invoices', 'filters'] }
  )
}

function clearFilters() {
  filterStatus.value = ''
  filterSortBy.value = 'createdAt'
  filterSortOrder.value = 'desc'
  router.get('/invoices', {}, { preserveState: true, only: ['invoices', 'filters'] })
}

function onPageChange(event: any) {
  router.get(
    '/invoices',
    { ...buildFilterParams(), page: event.page + 1 },
    { preserveState: true, only: ['invoices', 'filters'] }
  )
}

function onSort(event: any) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  router.get(
    '/invoices',
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
    <Head :title="t('invoices.title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900">{{ t('invoices.my_invoices') }}</h1>

    <!-- Filter bar -->
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="mb-1 block text-sm text-gray-600">{{ t('invoices.filter_status') }}</label>
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
      <Column :header="t('common.supplier')">
        <template #body="{ data }">{{ data.supplier?.displayName ?? '—' }}</template>
      </Column>
      <Column :header="t('common.items')">
        <template #body="{ data }">{{ data.orders?.length ?? 0 }}</template>
      </Column>
      <Column :header="t('common.total')" field="totalCost" sortable>
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
              v-if="!data.isPaid && !data.isPaymentRequested"
              :label="t('invoices.mark_paid')"
              icon="pi pi-check"
              size="small"
              severity="success"
              outlined
              @click="requestPaid(data.id)"
            />
            <Button
              v-if="data.isPaymentRequested && !data.isPaid"
              :label="t('invoices.cancel_paid')"
              icon="pi pi-times"
              size="small"
              severity="secondary"
              outlined
              @click="cancelPaid(data.id)"
            />
            <Button
              v-if="data.supplier?.iban && !data.isPaid"
              icon="pi pi-qrcode"
              size="small"
              severity="info"
              outlined
              @click="showQr(data.id)"
            />
          </div>
        </template>
      </Column>

      <template #empty>
        <div class="py-8 text-center text-gray-500">{{ t('invoices.no_invoices') }}</div>
      </template>
    </DataTable>

    <!-- QR Code Dialog -->
    <Dialog v-model:visible="qrDialog" header="QR platba" modal :style="{ width: '400px' }">
      <div class="text-center">
        <div v-if="qrLoading" class="py-8">
          <span class="pi pi-spin pi-spinner text-3xl text-gray-400" />
        </div>
        <template v-else>
          <img v-if="qrImage" :src="qrImage" alt="QR platba" class="mx-auto mb-4" />
          <p class="break-all text-xs text-gray-500">{{ qrCode }}</p>
        </template>
      </div>
    </Dialog>
  </AppLayout>
</template>
