<script setup lang="ts">
import { computed, ref } from 'vue'
import { Head } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Select from 'primevue/select'
import { useI18n } from '~/composables/use_i18n'
import { formatDateTime } from '~/composables/use_format_date'
import { useListFilters } from '~/composables/use_list_filters'
import { getAuditActionLabel, getAuditActionOptions } from '~/composables/use_audit_actions'
import FilterBar from '~/components/FilterBar.vue'
import PaginatedDataTable from '~/components/PaginatedDataTable.vue'

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

const props = defineProps<{
  logs: PaginatedLogs
  filters: { action: string; sortOrder: string }
}>()
const { t } = useI18n()
const ALL = '__all__'

const filterAction = ref(props.filters.action || ALL)
const filterSortOrder = ref(props.filters.sortOrder || 'desc')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const actionOptions = getAuditActionOptions(t, t('common.all'), ALL)

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
    sortOrder: filterSortOrder.value || undefined,
  }
}

const { applyFilters, navigateClear, onPageChange } = useListFilters({
  route: '/audit',
  onlyProps: ['logs', 'filters'],
  buildParams: buildParams,
  getCurrentPage: () => props.logs.meta.currentPage,
})

function clearFilters() {
  filterAction.value = ALL
  filterSortOrder.value = 'desc'
  navigateClear()
}

function onSort(event: any) {
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  applyFilters()
}
</script>

<template>
  <AppLayout>
    <Head :title="t('audit.title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900 dark:text-zinc-100">
      {{ t('audit.heading') }}
    </h1>

    <!-- Filters -->
    <FilterBar @apply="applyFilters" @clear="clearFilters">
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
    </FilterBar>

    <PaginatedDataTable
      :value="logs.data"
      :meta="logs.meta"
      sortField="createdAt"
      :sortOrder="sortOrderNum"
      @sort="onSort"
      @page="onPageChange"
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
    </PaginatedDataTable>
  </AppLayout>
</template>
