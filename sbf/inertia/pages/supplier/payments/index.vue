<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import { useI18n } from '~/composables/useI18n'
import { formatDate } from '~/composables/useFormatDate'

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

const props = defineProps<{ invoices: PaginatedInvoices }>()
const { t } = useI18n()

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

function onPageChange(event: any) {
  router.get('/supplier/payments', { page: event.page + 1 }, { preserveState: true })
}
</script>

<template>
  <AppLayout>
    <Head :title="t('supplier.payments_title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900">{{ t('supplier.payments_heading') }}</h1>

    <DataTable
      :value="invoices.data"
      :paginator="invoices.meta.lastPage > 1"
      :rows="invoices.meta.perPage"
      :totalRecords="invoices.meta.total"
      :lazy="true"
      :first="(invoices.meta.currentPage - 1) * invoices.meta.perPage"
      @page="onPageChange"
      stripedRows
      class="rounded-lg border"
    >
      <Column header="#" style="width: 60px">
        <template #body="{ data }">{{ data.id }}</template>
      </Column>
      <Column :header="t('common.date')">
        <template #body="{ data }">{{ formatDate(data.createdAt) }}</template>
      </Column>
      <Column :header="t('common.customer')">
        <template #body="{ data }">{{ data.buyer?.displayName ?? '—' }}</template>
      </Column>
      <Column :header="t('common.total')">
        <template #body="{ data }">
          <span class="font-semibold">{{ t('common.price_with_currency', { price: data.totalCost }) }}</span>
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
            <Tag v-if="data.isPaid" :value="t('common.approved')" severity="success" class="text-xs" />
          </div>
        </template>
      </Column>

      <template #empty>
        <div class="py-8 text-center text-gray-500">{{ t('supplier.payments_no_invoices') }}</div>
      </template>
    </DataTable>
  </AppLayout>
</template>
