<script setup lang="ts">
import { Head } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Card from 'primevue/card'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import { useI18n } from '~/composables/use_i18n'
import { formatDate } from '~/composables/use_format_date'

interface RecentOrder {
  id: number
  channel: string
  createdAt: string
  buyerName: string
  productName: string
  price: number
  supplierName: string
}

interface Stats {
  users: { total: number; customers: number; suppliers: number; admins: number; disabled: number }
  orders: { total: number; totalRevenue: number; lastWeek: number; lastMonth: number }
  invoices: { total: number; paid: number; unpaid: number; unpaidAmount: number }
  recentOrders: RecentOrder[]
}

const props = defineProps<{ stats: Stats }>()
const { t } = useI18n()

function channelSeverity(ch: string): 'info' | 'success' | 'warn' {
  if (ch === 'web') return 'info'
  if (ch === 'keypad') return 'success'
  return 'warn'
}
</script>

<template>
  <AppLayout>
    <Head :title="t('admin.dashboard_title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900 dark:text-zinc-100">
      {{ t('admin.dashboard_title') }}
    </h1>

    <!-- Stats grid -->
    <div class="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card class="text-center">
        <template #content>
          <div class="text-3xl font-bold">{{ stats.users.total }}</div>
          <div class="text-sm text-gray-500 dark:text-zinc-400">
            {{ t('admin.dashboard_total_users') }}
          </div>
          <div class="mt-1 text-xs text-gray-400 dark:text-zinc-500">
            {{
              t('admin.dashboard_users_detail', {
                customers: stats.users.customers,
                suppliers: stats.users.suppliers,
                admins: stats.users.admins,
              })
            }}
          </div>
        </template>
      </Card>
      <Card class="text-center">
        <template #content>
          <div class="text-3xl font-bold">{{ stats.orders.total }}</div>
          <div class="text-sm text-gray-500 dark:text-zinc-400">
            {{ t('admin.dashboard_total_orders') }}
          </div>
          <div class="mt-1 text-xs text-gray-400 dark:text-zinc-500">
            {{
              t('admin.dashboard_orders_detail', {
                lastWeek: stats.orders.lastWeek,
                lastMonth: stats.orders.lastMonth,
              })
            }}
          </div>
        </template>
      </Card>
      <Card class="text-center">
        <template #content>
          <div class="text-3xl font-bold">
            {{ t('common.price_with_currency', { price: stats.orders.totalRevenue }) }}
          </div>
          <div class="text-sm text-gray-500 dark:text-zinc-400">
            {{ t('admin.dashboard_total_revenue') }}
          </div>
        </template>
      </Card>
      <Card class="text-center">
        <template #content>
          <div class="text-3xl font-bold text-orange-600">
            {{ t('common.price_with_currency', { price: stats.invoices.unpaidAmount }) }}
          </div>
          <div class="text-sm text-gray-500 dark:text-zinc-400">{{ t('common.unpaid') }}</div>
          <div class="mt-1 text-xs text-gray-400 dark:text-zinc-500">
            {{
              t('admin.dashboard_invoices_detail', {
                paid: stats.invoices.paid,
                unpaid: stats.invoices.unpaid,
              })
            }}
          </div>
        </template>
      </Card>
    </div>

    <!-- Recent orders -->
    <h2 class="mb-4 text-lg font-semibold text-gray-800 dark:text-zinc-200">
      {{ t('admin.dashboard_recent_orders') }}
    </h2>
    <DataTable :value="stats.recentOrders" stripedRows class="rounded-lg border">
      <Column header="#" style="width: 60px">
        <template #body="{ data }">{{ data.id }}</template>
      </Column>
      <Column :header="t('common.date')">
        <template #body="{ data }">{{ formatDate(data.createdAt) }}</template>
      </Column>
      <Column :header="t('common.customer')">
        <template #body="{ data }">{{ data.buyerName }}</template>
      </Column>
      <Column :header="t('common.product')">
        <template #body="{ data }">{{ data.productName }}</template>
      </Column>
      <Column :header="t('common.price')" style="width: 100px">
        <template #body="{ data }">{{
          t('common.price_with_currency', { price: data.price })
        }}</template>
      </Column>
      <Column :header="t('common.channel')" style="width: 100px">
        <template #body="{ data }">
          <Tag
            :value="t(`common.channel_${data.channel}`)"
            :severity="channelSeverity(data.channel)"
            class="text-xs"
          />
        </template>
      </Column>
    </DataTable>
  </AppLayout>
</template>
