<script setup lang="ts">
import { ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import { useI18n } from '~/composables/useI18n'

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

const props = defineProps<{ invoices: PaginatedInvoices }>()

const { t } = useI18n()

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('cs-CZ', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
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
        'X-XSRF-TOKEN': decodeURIComponent(
          document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] || ''
        ),
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

function onPageChange(event: any) {
  router.get('/invoices', { page: event.page + 1 }, { preserveState: true })
}
</script>

<template>
  <AppLayout>
    <Head :title="t('invoices.title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900">{{ t('invoices.my_invoices') }}</h1>

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
      <Column :header="t('common.supplier')">
        <template #body="{ data }">{{ data.supplier?.displayName ?? '—' }}</template>
      </Column>
      <Column :header="t('common.items')">
        <template #body="{ data }">{{ data.orders?.length ?? 0 }}</template>
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
