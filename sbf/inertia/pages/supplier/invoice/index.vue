<script setup lang="ts">
import { computed } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Message from 'primevue/message'
import ConfirmDialog from 'primevue/confirmdialog'
import { useConfirm } from 'primevue/useconfirm'
import { useI18n } from '~/composables/use_i18n'

interface UninvoicedGroup {
  buyerId: number
  buyerName: string
  orderCount: number
  totalCost: number
}

const props = defineProps<{ uninvoiced: UninvoicedGroup[] }>()
const confirm = useConfirm()
const { t } = useI18n()

const totalOrders = computed(() => props.uninvoiced.reduce((s, g) => s + g.orderCount, 0))
const totalCost = computed(() => props.uninvoiced.reduce((s, g) => s + g.totalCost, 0))

function generateInvoices() {
  confirm.require({
    message: t('supplier.invoice_confirm', { count: props.uninvoiced.length }),
    header: t('common.confirm'),
    icon: 'pi pi-file-export',
    acceptLabel: t('supplier.invoice_generate'),
    rejectLabel: t('common.cancel'),
    accept: () => {
      router.post('/supplier/invoice/generate')
    },
  })
}
</script>

<template>
  <AppLayout>
    <Head :title="t('supplier.invoice_title')" />
    <ConfirmDialog />

    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900">{{ t('supplier.invoice_heading') }}</h1>
      <Button
        v-if="uninvoiced.length > 0"
        :label="t('supplier.invoice_generate')"
        icon="pi pi-file-export"
        @click="generateInvoices"
      />
    </div>

    <Message v-if="uninvoiced.length === 0" severity="info" :closable="false">
      {{ t('supplier.invoice_no_orders') }}
    </Message>

    <template v-else>
      <!-- Summary -->
      <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card class="text-center">
          <template #content>
            <div class="text-3xl font-bold">{{ uninvoiced.length }}</div>
            <div class="text-sm text-gray-500">{{ t('supplier.invoice_customers') }}</div>
          </template>
        </Card>
        <Card class="text-center">
          <template #content>
            <div class="text-3xl font-bold">{{ totalOrders }}</div>
            <div class="text-sm text-gray-500">{{ t('supplier.invoice_orders') }}</div>
          </template>
        </Card>
        <Card class="text-center">
          <template #content>
            <div class="text-3xl font-bold">
              {{ t('common.price_with_currency', { price: totalCost }) }}
            </div>
            <div class="text-sm text-gray-500">{{ t('common.total') }}</div>
          </template>
        </Card>
      </div>

      <!-- Per-customer breakdown -->
      <DataTable :value="uninvoiced" stripedRows class="rounded-lg border">
        <Column :header="t('common.customer')" field="buyerName" />
        <Column :header="t('supplier.invoice_orders')" field="orderCount" style="width: 130px" />
        <Column :header="t('common.total')" style="width: 130px">
          <template #body="{ data }">
            <span class="font-semibold">{{
              t('common.price_with_currency', { price: data.totalCost })
            }}</span>
          </template>
        </Column>
      </DataTable>
    </template>
  </AppLayout>
</template>
