<script setup lang="ts">
import { ref, computed } from 'vue'
import { Head, router, usePage } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import ConfirmDialog from 'primevue/confirmdialog'
import { useConfirm } from 'primevue/useconfirm'
import { useI18n } from '~/composables/use_i18n'
import type { SharedProps } from '~/types'

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
  hasUninvoicedOrders: boolean
  hasUnpaidInvoices: boolean
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
const page = usePage<SharedProps>()
const currentUserId = computed(() => page.props.user?.id)
const confirm = useConfirm()

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

function toggleDisabled(userId: number, isDisabled: boolean, data: UserRow) {
  if (isDisabled && data.hasUninvoicedOrders) {
    // Server will block this — show client-side info instead of a pointless confirm
    confirm.require({
      message: t('messages.user_has_uninvoiced_orders'),
      header: t('common.confirm'),
      icon: 'pi pi-exclamation-triangle',
      rejectLabel: t('common.close'),
      acceptClass: 'hidden',
    })
    return
  }

  if (isDisabled && data.hasUnpaidInvoices) {
    confirm.require({
      message: t('admin.users_disable_unpaid_confirm', { name: data.displayName }),
      header: t('common.confirm'),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: t('common.confirm'),
      rejectLabel: t('common.cancel'),
      accept: () => {
        router.put(`/admin/users/${userId}`, { isDisabled }, { preserveState: true })
      },
    })
    return
  }

  router.put(`/admin/users/${userId}`, { isDisabled }, { preserveState: true })
}

function generateInvoiceForUser(userId: number, displayName: string) {
  confirm.require({
    message: t('admin.users_generate_invoice_confirm', { name: displayName }),
    header: t('common.confirm'),
    icon: 'pi pi-file-invoice',
    acceptLabel: t('admin.users_generate_invoice'),
    rejectLabel: t('common.cancel'),
    accept: () => {
      router.post(`/admin/users/${userId}/generate-invoice`)
    },
  })
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

function impersonateUser(userId: number) {
  router.post(`/admin/users/${userId}/impersonate`)
}
</script>

<template>
  <AppLayout>
    <Head :title="t('admin.users_title')" />
    <ConfirmDialog />

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
            @update:modelValue="(val: boolean) => toggleDisabled(data.id, val, data)"
          />
        </template>
      </Column>

      <Column :header="t('admin.users_actions')" style="width: 150px">
        <template #body="{ data }">
          <div class="flex items-center gap-1">
            <Button
              v-if="data.hasUninvoicedOrders"
              icon="pi pi-file-invoice"
              severity="warn"
              size="small"
              text
              :aria-label="t('admin.users_generate_invoice')"
              @click="generateInvoiceForUser(data.id, data.displayName)"
            />
            <Tag
              v-else-if="data.hasUnpaidInvoices"
              severity="warn"
              icon="pi pi-exclamation-circle"
              :aria-label="t('admin.users_has_unpaid')"
            />
            <Button
              v-if="
                !data.isKiosk &&
                data.role !== 'admin' &&
                data.id !== currentUserId &&
                !data.isDisabled
              "
              icon="pi pi-user-edit"
              severity="warn"
              size="small"
              text
              :aria-label="t('admin.impersonate')"
              @click="impersonateUser(data.id)"
            />
          </div>
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
