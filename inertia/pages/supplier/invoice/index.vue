<script setup lang="ts">
import { computed } from 'vue'
import { Head, router, usePage } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Message from 'primevue/message'
import ConfirmDialog from 'primevue/confirmdialog'
import { useAppConfirm } from '~/composables/use_app_confirm'
import { useI18n } from '~/composables/use_i18n'
import { useMoney } from '~/composables/use_pricing'
import type { SharedProps } from '~/types'

interface UninvoicedGroup {
  buyerId: number
  buyerName: string
  orderCount: number
  totalCost: number
}

const props = defineProps<{ uninvoiced: UninvoicedGroup[] }>()
const confirm = useAppConfirm()
const { t } = useI18n()
const { amount, money } = useMoney()
const page = usePage<SharedProps>()

/** The supplier's own purchases from their own stock — labelled so they are not mistaken for a colleague. */
const isOwn = (group: UninvoicedGroup) => group.buyerId === page.props.user?.id

/**
 * The KPIs count what colleagues owe — the supplier's own consumption is shown apart, the
 * same way Hospodaření ("Dluží mi") and MCP (totalUninvoiced) leave it out.
 */
const others = computed(() => props.uninvoiced.filter((g) => !isOwn(g)))
const own = computed(() => props.uninvoiced.find(isOwn) ?? null)
const totalOrders = computed(() => others.value.reduce((s, g) => s + g.orderCount, 0))
const totalCost = computed(() => others.value.reduce((s, g) => s + g.totalCost, 0))

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

function generateInvoiceForBuyer(
  buyerId: number,
  buyerName: string,
  orderCount: number,
  totalCost: number
) {
  confirm.require({
    message: t('supplier.invoice_confirm_buyer', {
      name: buyerName,
      count: orderCount,
      amount: amount(totalCost),
    }),
    header: t('common.confirm'),
    icon: 'pi pi-receipt',
    acceptLabel: t('supplier.invoice_generate_for_buyer'),
    rejectLabel: t('common.cancel'),
    accept: () => {
      router.post(`/supplier/invoice/generate/${buyerId}`)
    },
  })
}
</script>

<template>
  <AppLayout>
    <Head :title="t('supplier.invoice_title')" />
    <ConfirmDialog />

    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
        {{ t('supplier.invoice_title') }}
      </h1>
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
        <Card>
          <template #content>
            <div
              class="text-2xl font-bold text-gray-900 dark:text-zinc-100"
              data-testid="invoice-kpi-customers"
            >
              {{ others.length }}
            </div>
            <div class="text-sm text-gray-500 dark:text-zinc-400">
              {{ t('supplier.invoice_customers') }}
            </div>
          </template>
        </Card>
        <Card>
          <template #content>
            <div
              class="text-2xl font-bold text-gray-900 dark:text-zinc-100"
              data-testid="invoice-kpi-orders"
            >
              {{ totalOrders }}
            </div>
            <div class="text-sm text-gray-500 dark:text-zinc-400">
              {{ t('supplier.invoice_orders') }}
            </div>
          </template>
        </Card>
        <Card>
          <template #content>
            <div
              class="text-2xl font-bold text-gray-900 dark:text-zinc-100"
              data-testid="invoice-kpi-total"
            >
              {{ money(totalCost) }}
            </div>
            <div class="text-sm text-gray-500 dark:text-zinc-400">{{ t('common.total') }}</div>
            <div
              v-if="own"
              class="mt-1 text-xs text-gray-500 dark:text-zinc-400"
              data-testid="invoice-kpi-own"
            >
              {{ t('supplier.invoice_own_total', { amount: money(own.totalCost) }) }}
            </div>
          </template>
        </Card>
      </div>

      <!-- Per-customer breakdown -->
      <DataTable
        :value="uninvoiced"
        stripedRows
        class="rounded-lg border"
        data-testid="invoice-table"
      >
        <Column :header="t('common.customer')">
          <template #body="{ data }">
            <span>{{ data.buyerName }}</span>
            <span
              v-if="isOwn(data)"
              class="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-zinc-700 dark:text-zinc-200"
              data-testid="invoice-own-consumption"
              >{{ t('supplier.invoice_own_consumption') }}</span
            >
          </template>
        </Column>
        <Column
          :header="t('supplier.invoice_orders')"
          field="orderCount"
          headerClass="sbf-col-number"
          bodyClass="sbf-col-number"
        />
        <Column :header="t('common.total')" headerClass="sbf-col-price" bodyClass="sbf-col-price">
          <template #body="{ data }">
            <span class="font-semibold">{{ money(data.totalCost) }}</span>
          </template>
        </Column>
        <Column
          :header="t('common.actions')"
          headerClass="sbf-col-action"
          bodyClass="sbf-col-action"
        >
          <template #body="{ data }">
            <Button
              :label="t('supplier.invoice_generate_for_buyer')"
              size="small"
              severity="secondary"
              text
              class="whitespace-nowrap"
              @click="
                generateInvoiceForBuyer(
                  data.buyerId,
                  data.buyerName,
                  data.orderCount,
                  data.totalCost
                )
              "
            />
          </template>
        </Column>
      </DataTable>
    </template>
  </AppLayout>
</template>
