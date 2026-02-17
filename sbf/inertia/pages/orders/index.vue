<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Card from 'primevue/card'

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
}>()

function onPageChange(event: any) {
  router.get('/orders', { page: event.page + 1 }, { preserveState: true })
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function channelLabel(channel: string) {
  const map: Record<string, string> = { web: 'Web', keypad: 'Klávesnice', scanner: 'Skener' }
  return map[channel] || channel
}
</script>

<template>
  <AppLayout>
    <Head title="Objednávky" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900">Moje objednávky</h1>

    <!-- Stats cards -->
    <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card class="text-center">
        <template #content>
          <div class="text-3xl font-bold text-gray-900">{{ stats.totalOrders }}</div>
          <div class="text-sm text-gray-500">Celkem objednávek</div>
        </template>
      </Card>
      <Card class="text-center">
        <template #content>
          <div class="text-3xl font-bold text-gray-900">{{ stats.totalSpend }} Kč</div>
          <div class="text-sm text-gray-500">Celková útrata</div>
        </template>
      </Card>
      <Card class="text-center">
        <template #content>
          <div class="text-3xl font-bold text-red-600">{{ stats.totalUnpaid }} Kč</div>
          <div class="text-sm text-gray-500">Nezaplaceno</div>
        </template>
      </Card>
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
      <Column header="Datum" sortable>
        <template #body="{ data }">
          {{ formatDate(data.createdAt) }}
        </template>
      </Column>
      <Column header="Produkt">
        <template #body="{ data }">
          {{ data.delivery?.product?.displayName ?? '—' }}
        </template>
      </Column>
      <Column header="Cena">
        <template #body="{ data }">
          <span class="font-semibold">{{ data.delivery?.price ?? '—' }} Kč</span>
        </template>
      </Column>
      <Column header="Dodavatel">
        <template #body="{ data }">
          {{ data.delivery?.supplier?.displayName ?? '—' }}
        </template>
      </Column>
      <Column header="Kanál">
        <template #body="{ data }">
          <Tag :value="channelLabel(data.channel)" severity="info" class="text-xs" />
        </template>
      </Column>
      <Column header="Faktura">
        <template #body="{ data }">
          <Tag
            v-if="data.invoiceId"
            :value="'#' + data.invoiceId"
            severity="success"
            class="text-xs"
          />
          <Tag v-else value="Nefakturováno" severity="warn" class="text-xs" />
        </template>
      </Column>

      <template #empty>
        <div class="py-8 text-center text-gray-500">
          Zatím nemáte žádné objednávky.
        </div>
      </template>
    </DataTable>
  </AppLayout>
</template>
