<script setup lang="ts">
import { ref } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import { useI18n } from '~/composables/use_i18n'

interface UserRow {
  id: number
  displayName: string
  email: string
  username: string | null
  role: 'customer' | 'supplier' | 'admin'
  isKiosk: boolean
  isDisabled: boolean
  keypadId: number
  createdAt: string
}

interface PaginatedUsers {
  data: UserRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
}

const props = defineProps<{
  users: PaginatedUsers
  filters: { search: string; role: string }
}>()
const { t } = useI18n()

const filterSearch = ref(props.filters.search)
const filterRole = ref(props.filters.role)

const roleOptions = [
  { label: t('common.all'), value: '' },
  { label: t('common.role_customer'), value: 'customer' },
  { label: t('common.role_supplier'), value: 'supplier' },
  { label: t('common.role_admin'), value: 'admin' },
]

const roleEditOptions = [
  { label: t('common.role_customer'), value: 'customer' },
  { label: t('common.role_supplier'), value: 'supplier' },
  { label: t('common.role_admin'), value: 'admin' },
]

function roleSeverity(role: string): 'info' | 'warn' | 'danger' {
  if (role === 'admin') return 'danger'
  if (role === 'supplier') return 'warn'
  return 'info'
}

function updateRole(userId: number, role: string) {
  router.put(`/admin/users/${userId}`, { role }, { preserveState: true })
}

function toggleDisabled(userId: number, isDisabled: boolean) {
  router.put(`/admin/users/${userId}`, { isDisabled }, { preserveState: true })
}

function toggleKiosk(userId: number, isKiosk: boolean) {
  router.put(`/admin/users/${userId}`, { isKiosk }, { preserveState: true })
}

function applyFilters() {
  router.get(
    '/admin/users',
    {
      search: filterSearch.value || undefined,
      role: filterRole.value || undefined,
      page: 1,
    },
    { preserveState: true, only: ['users', 'filters'] }
  )
}

function clearFilters() {
  filterSearch.value = ''
  filterRole.value = ''
  router.get('/admin/users', {}, { preserveState: true, only: ['users', 'filters'] })
}

function onPageChange(event: any) {
  router.get(
    '/admin/users',
    {
      page: event.page + 1,
      search: filterSearch.value || undefined,
      role: filterRole.value || undefined,
    },
    { preserveState: true, only: ['users', 'filters'] }
  )
}
</script>

<template>
  <AppLayout>
    <Head :title="t('admin.users_title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900 dark:text-zinc-100">
      {{ t('admin.users_heading') }}
    </h1>

    <!-- Filter bar -->
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('admin.users_search')
        }}</label>
        <InputText v-model="filterSearch" class="w-56" @keydown.enter="applyFilters" />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('admin.users_filter_role')
        }}</label>
        <Select
          v-model="filterRole"
          :options="roleOptions"
          optionLabel="label"
          optionValue="value"
          class="w-40"
        />
      </div>
      <Button
        :label="t('common.filter_apply')"
        icon="pi pi-filter"
        size="small"
        @click="applyFilters"
      />
      <Button
        :label="t('common.filter_clear')"
        size="small"
        severity="secondary"
        text
        @click="clearFilters"
      />
    </div>

    <DataTable
      :value="users.data"
      :paginator="users.meta.lastPage > 1"
      :rows="users.meta.perPage"
      :totalRecords="users.meta.total"
      :lazy="true"
      :first="(users.meta.currentPage - 1) * users.meta.perPage"
      @page="onPageChange"
      stripedRows
      class="rounded-lg border"
    >
      <Column :header="t('admin.users_col_id')" style="width: 60px">
        <template #body="{ data }">{{ data.keypadId }}</template>
      </Column>
      <Column :header="t('admin.users_name')">
        <template #body="{ data }">{{ data.displayName }}</template>
      </Column>
      <Column :header="t('admin.users_col_email')">
        <template #body="{ data }">{{ data.email }}</template>
      </Column>
      <Column :header="t('admin.users_col_role')" style="width: 170px">
        <template #body="{ data }">
          <Select
            :modelValue="data.role"
            :options="roleEditOptions"
            optionLabel="label"
            optionValue="value"
            class="w-full"
            @update:modelValue="(val: string) => updateRole(data.id, val)"
          />
        </template>
      </Column>
      <Column :header="t('admin.users_kiosk')" style="width: 80px">
        <template #body="{ data }">
          <ToggleSwitch
            :modelValue="data.isKiosk"
            @update:modelValue="(val: boolean) => toggleKiosk(data.id, val)"
          />
        </template>
      </Column>
      <Column :header="t('admin.users_disabled')" style="width: 100px">
        <template #body="{ data }">
          <ToggleSwitch
            :modelValue="data.isDisabled"
            @update:modelValue="(val: boolean) => toggleDisabled(data.id, val)"
          />
        </template>
      </Column>

      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('common.no_data') }}
        </div>
      </template>
    </DataTable>
  </AppLayout>
</template>
