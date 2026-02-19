<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import { useI18n } from '~/composables/use_i18n'
import { formatDateTime } from '~/composables/use_format_date'

interface AuditRow {
  id: number
  action: string
  entityType: string
  entityId: number | null
  metadata: Record<string, any> | null
  user: { displayName: string } | null
  targetUser: { displayName: string } | null
  createdAt: string
}

interface PaginatedLogs {
  data: AuditRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
}

defineProps<{ logs: PaginatedLogs }>()
const { t } = useI18n()

const actionLabels: Record<string, string> = {
  'order.created': 'audit.action_order_created',
  'invoice.generated': 'audit.action_invoice_generated',
  'payment.requested': 'audit.action_payment_requested',
  'payment.approved': 'audit.action_payment_approved',
  'payment.rejected': 'audit.action_payment_rejected',
  'delivery.created': 'audit.action_delivery_created',
  'product.created': 'audit.action_product_created',
  'product.updated': 'audit.action_product_updated',
  'profile.updated': 'audit.action_profile_updated',
  'user.updated': 'audit.action_user_updated',
  'order.storno': 'audit.action_order_storno',
}

function actionLabel(action: string | undefined) {
  if (!action) return ''
  return t(actionLabels[action] ?? action)
}

function formatMetadata(meta: Record<string, any> | null) {
  if (!meta) return ''
  return Object.entries(meta)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
}

function onPageChange(event: any) {
  router.get('/audit', { page: event.page + 1 }, { preserveState: true, only: ['logs'] })
}
</script>

<template>
  <AppLayout>
    <Head :title="t('audit.title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900">{{ t('audit.heading') }}</h1>

    <DataTable
      :value="logs.data"
      :paginator="logs.meta.lastPage > 1"
      :rows="logs.meta.perPage"
      :totalRecords="logs.meta.total"
      :lazy="true"
      :first="(logs.meta.currentPage - 1) * logs.meta.perPage"
      @page="onPageChange"
      stripedRows
      class="rounded-lg border"
    >
      <Column :header="t('audit.date')">
        <template #body="{ data }">{{ formatDateTime(data.createdAt) }}</template>
      </Column>
      <Column :header="t('audit.action')">
        <template #body="{ data }">
          <Tag :value="actionLabel(data.action)" severity="info" class="text-xs" />
        </template>
      </Column>
      <Column :header="t('audit.entity')">
        <template #body="{ data }">
          {{ data.entityType }}
          <span v-if="data.entityId" class="text-gray-400">#{{ data.entityId }}</span>
        </template>
      </Column>
      <Column :header="t('audit.details')">
        <template #body="{ data }">
          <span class="text-sm text-gray-600">{{ formatMetadata(data.metadata) }}</span>
        </template>
      </Column>

      <template #empty>
        <div class="py-8 text-center text-gray-500">{{ t('audit.no_logs') }}</div>
      </template>
    </DataTable>
  </AppLayout>
</template>
