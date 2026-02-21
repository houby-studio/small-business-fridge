<script setup lang="ts">
import { ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Select from 'primevue/select'
import Button from 'primevue/button'
import { useI18n } from '~/composables/use_i18n'
import { formatDateTime } from '~/composables/use_format_date'

interface AuditRow {
  id: number
  action: string
  entityType: string
  entityId: number | null
  metadata: Record<string, any> | null
  user: { id: number; displayName: string } | null
  targetUser: { id: number; displayName: string } | null
  createdAt: string
}

interface PaginatedLogs {
  data: AuditRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
}

const props = defineProps<{
  logs: PaginatedLogs
  filters: { action: string; entityType: string; userId: string; sortOrder: string }
  users: { id: number; displayName: string }[]
}>()
const { t } = useI18n()

const filterAction = ref(props.filters.action)
const filterEntity = ref(props.filters.entityType)
const filterUserId = ref(props.filters.userId ? Number(props.filters.userId) : null)
const filterSortOrder = ref(props.filters.sortOrder || 'desc')

const userOptions = [{ id: null, displayName: '—' }, ...props.users]

const actionOptions = [
  { label: '—', value: '' },
  { label: t('audit.action_order_created'), value: 'order.created' },
  { label: t('audit.action_invoice_generated'), value: 'invoice.generated' },
  { label: t('audit.action_payment_requested'), value: 'payment.requested' },
  { label: t('audit.action_payment_approved'), value: 'payment.approved' },
  { label: t('audit.action_payment_rejected'), value: 'payment.rejected' },
  { label: t('audit.action_delivery_created'), value: 'delivery.created' },
  { label: t('audit.action_product_created'), value: 'product.created' },
  { label: t('audit.action_product_updated'), value: 'product.updated' },
  { label: t('audit.action_profile_updated'), value: 'profile.updated' },
  { label: t('audit.action_user_updated'), value: 'user.updated' },
  { label: t('audit.action_order_storno'), value: 'order.storno' },
  { label: t('audit.action_user_login'), value: 'user.login' },
  { label: t('audit.action_user_registered'), value: 'user.registered' },
  { label: t('audit.action_user_logout'), value: 'user.logout' },
  { label: t('audit.action_profile_token_created'), value: 'profile.token.created' },
  { label: t('audit.action_admin_impersonate_start'), value: 'admin.impersonate.start' },
  { label: t('audit.action_admin_impersonate_stop'), value: 'admin.impersonate.stop' },
]

const entityOptions = [
  { label: '—', value: '' },
  { label: 'order', value: 'order' },
  { label: 'invoice', value: 'invoice' },
  { label: 'delivery', value: 'delivery' },
  { label: 'product', value: 'product' },
  { label: 'user', value: 'user' },
]

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
  'user.login': 'audit.action_user_login',
  'user.registered': 'audit.action_user_registered',
  'user.logout': 'audit.action_user_logout',
  'profile.token.created': 'audit.action_profile_token_created',
  'admin.impersonate.start': 'audit.action_admin_impersonate_start',
  'admin.impersonate.stop': 'audit.action_admin_impersonate_stop',
}

function actionLabel(action: string | undefined) {
  if (!action) return ''
  return t(actionLabels[action] ?? action)
}

function formatMetadata(meta: Record<string, any> | null): string {
  if (!meta) return ''
  return Object.entries(meta)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => {
      if (typeof v === 'object' && !Array.isArray(v) && v !== null) {
        if ('from' in v && 'to' in v) return `${k}: ${v.from ?? '—'} → ${v.to ?? '—'}`
        return `${k}: ${JSON.stringify(v)}`
      }
      return `${k}: ${v}`
    })
    .join(', ')
}

function buildParams() {
  return {
    action: filterAction.value || undefined,
    entityType: filterEntity.value || undefined,
    userId: filterUserId.value ?? undefined,
    sortOrder: filterSortOrder.value || undefined,
  }
}

function applyFilters() {
  router.get(
    '/admin/audit',
    { ...buildParams(), page: 1 },
    { preserveState: true, only: ['logs', 'filters'] }
  )
}

function clearFilters() {
  filterAction.value = ''
  filterEntity.value = ''
  filterUserId.value = null
  filterSortOrder.value = 'desc'
  router.get('/admin/audit', {}, { preserveState: true, only: ['logs', 'filters'] })
}

function onPageChange(event: any) {
  router.get(
    '/admin/audit',
    { ...buildParams(), page: event.page + 1 },
    { preserveState: true, only: ['logs', 'filters'] }
  )
}
</script>

<template>
  <AppLayout>
    <Head :title="t('audit.admin_title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900 dark:text-zinc-100">
      {{ t('audit.admin_heading') }}
    </h1>

    <!-- Filters -->
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('audit.filter_action')
        }}</label>
        <Select
          v-model="filterAction"
          :options="actionOptions"
          optionLabel="label"
          optionValue="value"
          class="w-48"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('audit.filter_entity')
        }}</label>
        <Select
          v-model="filterEntity"
          :options="entityOptions"
          optionLabel="label"
          optionValue="value"
          class="w-36"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('audit.filter_user')
        }}</label>
        <Select
          v-model="filterUserId"
          :options="userOptions"
          optionLabel="displayName"
          optionValue="id"
          filter
          class="w-48"
        />
      </div>
      <Button
        :label="t('audit.filter_apply')"
        icon="pi pi-filter"
        size="small"
        @click="applyFilters"
      />
      <Button
        :label="t('audit.filter_clear')"
        size="small"
        severity="secondary"
        text
        @click="clearFilters"
      />
    </div>

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
      <Column style="width: 160px">
        <template #header>
          <span
            class="cursor-pointer select-none"
            @click="
              () => {
                filterSortOrder = filterSortOrder === 'asc' ? 'desc' : 'asc'
                applyFilters()
              }
            "
          >
            {{ t('audit.date') }}
            <i
              :class="
                filterSortOrder === 'asc' ? 'pi pi-sort-amount-up-alt' : 'pi pi-sort-amount-down'
              "
              class="ml-1 text-xs"
            />
          </span>
        </template>
        <template #body="{ data }">{{ formatDateTime(data.createdAt) }}</template>
      </Column>
      <Column :header="t('audit.user')">
        <template #body="{ data }">{{ data.user?.displayName ?? '—' }}</template>
      </Column>
      <Column :header="t('audit.action')">
        <template #body="{ data }">
          <Tag :value="actionLabel(data.action)" severity="info" class="text-xs" />
        </template>
      </Column>
      <Column :header="t('audit.entity')">
        <template #body="{ data }">
          {{ data.entityType }}
          <span v-if="data.entityId" class="text-gray-400 dark:text-zinc-500"
            >#{{ data.entityId }}</span
          >
        </template>
      </Column>
      <Column :header="t('audit.target')">
        <template #body="{ data }">{{ data.targetUser?.displayName ?? '—' }}</template>
      </Column>
      <Column :header="t('audit.details')">
        <template #body="{ data }">
          <span class="text-sm text-gray-600 dark:text-zinc-400">{{
            formatMetadata(data.metadata)
          }}</span>
        </template>
      </Column>

      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('audit.no_logs') }}
        </div>
      </template>
    </DataTable>
  </AppLayout>
</template>
