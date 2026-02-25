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
import { areFilterParamsEqual } from '~/composables/use_filter_params'
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
  filters: { search: string; role: string; userId: string; sortBy: string; sortOrder: string }
  userOptions: { id: number; displayName: string }[]
}>()
const { t } = useI18n()
const page = usePage<SharedProps>()
const currentUserId = computed(() => page.props.user?.id)
const confirm = useConfirm()
const ALL = '__all__'

const filterSearch = ref(props.filters.search ?? '')
const filterRole = ref(props.filters.role || ALL)
const filterUserId = ref<number | string>(props.filters.userId ? Number(props.filters.userId) : ALL)
const filterSortBy = ref(props.filters.sortBy || 'keypadId')
const filterSortOrder = ref(props.filters.sortOrder || 'asc')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const roleOptions = [
  { label: t('common.all'), value: ALL },
  { label: t('common.role_customer'), value: 'customer' },
  { label: t('common.role_supplier'), value: 'supplier' },
  { label: t('common.role_admin'), value: 'admin' },
]
const userFilterOptions = [{ id: ALL, displayName: t('common.all') }, ...props.userOptions]

const roleEditOptions = [
  { label: t('common.role_customer'), value: 'customer' },
  { label: t('common.role_supplier'), value: 'supplier' },
  { label: t('common.role_admin'), value: 'admin' },
]

function buildFilterParams() {
  return {
    search: filterSearch.value || undefined,
    role: filterRole.value === ALL ? undefined : filterRole.value,
    userId: filterUserId.value === ALL ? undefined : filterUserId.value,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
  }
}

const lastAppliedFilterParams = ref(buildFilterParams())

function updateRole(userId: number, role: string) {
  router.put(`/admin/users/${userId}`, { role }, { preserveState: true })
}

function toggleDisabled(userId: number, isDisabled: boolean) {
  router.put(`/admin/users/${userId}`, { isDisabled }, { preserveState: true })
}

function generateInvoiceForUser(userId: number, displayName: string) {
  confirm.require({
    message: t('admin.users_generate_invoice_confirm', { name: displayName }),
    header: t('common.confirm'),
    icon: 'pi pi-receipt',
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
  const nextParams = buildFilterParams()
  const page = areFilterParamsEqual(nextParams, lastAppliedFilterParams.value)
    ? props.users.meta.currentPage
    : 1
  router.get(
    '/admin/users',
    {
      ...nextParams,
      page,
    },
    { preserveState: true, only: ['users', 'filters'] }
  )
  lastAppliedFilterParams.value = nextParams
}

function clearFilters() {
  filterSearch.value = ''
  filterRole.value = ALL
  filterUserId.value = ALL
  filterSortBy.value = 'keypadId'
  filterSortOrder.value = 'asc'
  lastAppliedFilterParams.value = buildFilterParams()
  router.get('/admin/users', buildFilterParams(), {
    preserveState: true,
    only: ['users', 'filters'],
  })
}

function onPageChange(event: any) {
  router.get(
    '/admin/users',
    {
      page: event.page + 1,
      ...buildFilterParams(),
    },
    { preserveState: true, only: ['users', 'filters'] }
  )
}

function onSort(event: any) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  router.get(
    '/admin/users',
    {
      ...buildFilterParams(),
      sortBy: event.sortField,
      sortOrder: event.sortOrder === 1 ? 'asc' : 'desc',
      page: 1,
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
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('admin.users_filter_user')
        }}</label>
        <Select
          v-model="filterUserId"
          :options="userFilterOptions"
          optionLabel="displayName"
          optionValue="id"
          filter
          class="w-56"
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
      :sortField="filterSortBy"
      :sortOrder="sortOrderNum"
      @page="onPageChange"
      @sort="onSort"
      stripedRows
      class="rounded-lg border"
    >
      <Column
        :header="t('admin.users_col_id')"
        field="keypadId"
        sortable
        headerClass="sbf-col-id"
        bodyClass="sbf-col-id"
      >
        <template #body="{ data }">{{ data.keypadId }}</template>
      </Column>
      <Column :header="t('admin.users_name')" field="displayName" sortable>
        <template #body="{ data }">{{ data.displayName }}</template>
      </Column>
      <Column :header="t('admin.users_col_email')">
        <template #body="{ data }">{{ data.email }}</template>
      </Column>
      <Column
        :header="t('admin.users_col_role')"
        headerClass="sbf-col-tight"
        bodyClass="sbf-col-tight"
      >
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
      <Column
        :header="t('admin.users_kiosk')"
        headerClass="sbf-col-tight"
        bodyClass="sbf-col-tight"
      >
        <template #body="{ data }">
          <ToggleSwitch
            :modelValue="data.isKiosk"
            @update:modelValue="(val: boolean) => toggleKiosk(data.id, val)"
          />
        </template>
      </Column>
      <Column
        :header="t('admin.users_disabled')"
        headerClass="sbf-col-tight"
        bodyClass="sbf-col-tight"
      >
        <template #body="{ data }">
          <!-- If user has pending issues and is currently active, show warning instead of toggle -->
          <span
            v-if="!data.isDisabled && (data.hasUninvoicedOrders || data.hasUnpaidInvoices)"
            v-tooltip.top="t('messages.user_has_uninvoiced_orders')"
            :aria-label="t('messages.user_has_uninvoiced_orders')"
          >
            <Tag severity="warn" icon="pi pi-exclamation-circle" />
          </span>
          <ToggleSwitch
            v-else
            :modelValue="data.isDisabled"
            @update:modelValue="(val: boolean) => toggleDisabled(data.id, val)"
          />
        </template>
      </Column>

      <Column
        :header="t('admin.users_actions')"
        headerClass="sbf-col-action"
        bodyClass="sbf-col-action"
      >
        <template #body="{ data }">
          <div class="flex items-center gap-1">
            <Button
              v-if="data.hasUninvoicedOrders"
              icon="pi pi-receipt"
              severity="warn"
              size="small"
              text
              :aria-label="t('admin.users_generate_invoice')"
              @click="generateInvoiceForUser(data.id, data.displayName)"
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
