<script setup lang="ts">
import { computed, ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Select from 'primevue/select'
import Button from 'primevue/button'
import { useI18n } from '~/composables/use_i18n'
import { formatDateTime } from '~/composables/use_format_date'
import { areFilterParamsEqual } from '~/composables/use_filter_params'
import { getAuditActionLabel, getAuditActionOptions } from '~/composables/use_audit_actions'

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
const ALL = '__all__'

const filterAction = ref(props.filters.action || ALL)
const filterEntity = ref(props.filters.entityType || ALL)
const filterUserId = ref<number | string>(props.filters.userId ? Number(props.filters.userId) : ALL)
const filterSortOrder = ref(props.filters.sortOrder || 'desc')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const userOptions = [{ id: ALL, displayName: t('common.all') }, ...props.users]

const actionOptions = getAuditActionOptions(t, t('common.all'), ALL)

const entityOptions = [
  { label: t('common.all'), value: ALL },
  { label: 'order', value: 'order' },
  { label: 'invoice', value: 'invoice' },
  { label: 'delivery', value: 'delivery' },
  { label: 'product', value: 'product' },
  { label: 'allergen', value: 'allergen' },
  { label: 'category', value: 'category' },
  { label: 'music', value: 'music' },
  { label: 'user', value: 'user' },
]

function actionLabel(action: string | undefined) {
  return getAuditActionLabel(action, t)
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
    action: filterAction.value === ALL ? undefined : filterAction.value,
    entityType: filterEntity.value === ALL ? undefined : filterEntity.value,
    userId: filterUserId.value === ALL ? undefined : filterUserId.value,
    sortOrder: filterSortOrder.value || undefined,
  }
}

const lastAppliedFilterParams = ref(buildParams())

function applyFilters() {
  const nextParams = buildParams()
  const page = areFilterParamsEqual(nextParams, lastAppliedFilterParams.value)
    ? props.logs.meta.currentPage
    : 1
  router.get(
    '/admin/audit',
    { ...nextParams, page },
    { preserveState: true, only: ['logs', 'filters'] }
  )
  lastAppliedFilterParams.value = nextParams
}

function clearFilters() {
  filterAction.value = ALL
  filterEntity.value = ALL
  filterUserId.value = ALL
  filterSortOrder.value = 'desc'
  lastAppliedFilterParams.value = buildParams()
  router.get('/admin/audit', buildParams(), { preserveState: true, only: ['logs', 'filters'] })
}

function onPageChange(event: any) {
  router.get(
    '/admin/audit',
    { ...buildParams(), page: event.page + 1 },
    { preserveState: true, only: ['logs', 'filters'] }
  )
}

function onSort(event: any) {
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  applyFilters()
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
      sortField="createdAt"
      :sortOrder="sortOrderNum"
      @sort="onSort"
      @page="onPageChange"
      stripedRows
      class="rounded-lg border"
    >
      <Column
        :header="t('audit.date')"
        field="createdAt"
        sortable
        headerClass="sbf-col-date"
        bodyClass="sbf-col-date"
      >
        <template #body="{ data }">{{ formatDateTime(data.createdAt) }}</template>
      </Column>
      <Column :header="t('audit.user')">
        <template #body="{ data }">{{ data.user?.displayName ?? '—' }}</template>
      </Column>
      <Column :header="t('audit.action')" headerClass="sbf-col-tight" bodyClass="sbf-col-tight">
        <template #body="{ data }">
          <Tag
            :value="actionLabel(data.action)"
            severity="info"
            class="text-xs whitespace-nowrap"
          />
        </template>
      </Column>
      <Column :header="t('audit.entity')" headerClass="sbf-col-tight" bodyClass="sbf-col-tight">
        <template #body="{ data }">
          <span class="sbf-nowrap">{{ data.entityType }}</span>
          <span v-if="data.entityId" class="text-gray-400 dark:text-zinc-500"
            >#{{ data.entityId }}</span
          >
        </template>
      </Column>
      <Column :header="t('audit.target')" headerClass="sbf-col-tight" bodyClass="sbf-col-tight">
        <template #body="{ data }">
          <span class="sbf-nowrap">{{ data.targetUser?.displayName ?? '—' }}</span>
        </template>
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
