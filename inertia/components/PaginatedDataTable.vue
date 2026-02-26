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
}>()

const emit = defineEmits<{
  page: [event: any]
  sort: [event: any]
}>()

const first = computed(() => (props.meta.currentPage - 1) * props.meta.perPage)
</script>

<template>
  <DataTable
    :value="value"
    :paginator="meta.lastPage > 1"
    :rows="meta.perPage"
    :totalRecords="meta.total"
    :lazy="true"
    :first="first"
    :sortField="sortField"
    :sortOrder="sortOrder"
    @page="emit('page', $event)"
    @sort="emit('sort', $event)"
    stripedRows
    class="rounded-lg border"
  >
    <slot />
    <template #empty>
      <slot name="empty" />
    </template>
  </DataTable>
</template>
