<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import { useI18n } from '~/composables/useI18n'

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

const props = defineProps<{ users: UserRow[] }>()
const { t } = useI18n()

const roleOptions = [
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
</script>

<template>
  <AppLayout>
    <Head :title="t('admin.users_title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900">{{ t('admin.users_heading') }}</h1>

    <DataTable :value="users" stripedRows class="rounded-lg border" :rowsPerPageOptions="[10, 20, 50]" :paginator="users.length > 10" :rows="20">
      <Column header="ID" field="keypadId" style="width: 60px" sortable />
      <Column :header="t('admin.users_name')" field="displayName" sortable />
      <Column header="Email" field="email" />
      <Column header="Role" style="width: 170px">
        <template #body="{ data }">
          <Select
            :modelValue="data.role"
            :options="roleOptions"
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
    </DataTable>
  </AppLayout>
</template>
