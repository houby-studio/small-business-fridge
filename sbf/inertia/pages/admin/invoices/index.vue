<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import { useI18n } from '~/composables/useI18n'
import { formatDate } from '~/composables/useFormatDate'

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

const props = defineProps<{ invoices: PaginatedInvoices }>()
const { t } = useI18n()

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

function onPageChange(event: any) {
  router.get('/admin/invoices', { page: event.page + 1 }, { preserveState: true })
}
</script>

<template>
  <AppLayout>
    <Head :title="t('admin.invoices_title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900">{{ t('admin.invoices_heading') }}</h1>

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
      <Column :header="t('common.supplier')">
        <template #body="{ data }">{{ data.supplier?.displayName ?? '—' }}</template>
      </Column>
      <Column :header="t('common.total')" style="width: 100px">
        <template #body="{ data }">
          <span class="font-semibold">{{ t('common.price_with_currency', { price: data.totalCost }) }}</span>
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
