<script setup lang="ts">
import { computed } from 'vue'
import DataTable from 'primevue/datatable'

interface PageMeta {
  total: number
  perPage: number
  currentPage: number
  lastPage: number
}

const props = defineProps<{
  value: any[]
  meta: PageMeta
  sortField?: string
  sortOrder?: number
  dataKey?: string
  expandedRows?: Record<string | number, boolean>
}>()

const emit = defineEmits<{
  'page': [event: any]
  'sort': [event: any]
  'update:expandedRows': [rows: any]
}>()

const first = computed(() => (props.meta.currentPage - 1) * props.meta.perPage)
</script>

<template>
  <DataTable
    :value="value"
    :paginator="meta.total > 0"
    :rows="meta.perPage"
    :totalRecords="meta.total"
    :lazy="true"
    :first="first"
    :sortField="sortField"
    :sortOrder="sortOrder"
    :dataKey="dataKey"
    :expandedRows="expandedRows"
    @page="emit('page', $event)"
    @sort="emit('sort', $event)"
    @update:expandedRows="emit('update:expandedRows', $event)"
    stripedRows
    class="rounded-lg border"
  >
    <slot />
    <template #empty>
      <slot name="empty" />
    </template>
    <template v-if="$slots.expansion" #expansion="slotProps">
      <slot name="expansion" v-bind="slotProps" />
    </template>
  </DataTable>
</template>
