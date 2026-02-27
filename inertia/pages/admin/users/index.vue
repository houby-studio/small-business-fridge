<script setup lang="ts">
import { ref, computed } from 'vue'
import { Head, router, useForm, usePage } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import ConfirmDialog from 'primevue/confirmdialog'
import { useConfirm } from 'primevue/useconfirm'
import { useI18n } from '~/composables/use_i18n'
import { useListFilters } from '~/composables/use_list_filters'
import { useSelectEnterKey } from '~/composables/use_select_enter_key'
import FilterBar from '~/components/FilterBar.vue'
import PaginatedDataTable from '~/components/PaginatedDataTable.vue'
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

interface InviteRow {
  id: number
  email: string
  role: 'customer' | 'supplier' | 'admin'
  createdAt: string
  expiresAt: string
  acceptedAt: string | null
  revokedAt: string | null
}

const props = defineProps<{
  users: PaginatedUsers
  filters: { role: string; userId: string; disabled: string; sortBy: string; sortOrder: string }
  userOptions: { id: number; displayName: string }[]
  invitations: InviteRow[]
  registrationPolicy: {
    mode: 'open' | 'invite_only' | 'domain_auto_approve' | 'closed'
    allowedDomains: string[]
  }
}>()
const { t } = useI18n()
const page = usePage<SharedProps>()
const currentUserId = computed(() => page.props.user?.id)
const confirm = useConfirm()
const ALL = '__all__'

const filterRole = ref(props.filters.role || ALL)
const filterUserId = ref<number | string>(props.filters.userId ? Number(props.filters.userId) : ALL)
const filterDisabled = ref(props.filters.disabled || ALL)
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
const disabledOptions = [
  { label: t('common.all'), value: ALL },
  { label: t('admin.users_filter_enabled'), value: 'enabled' },
  { label: t('admin.users_disabled'), value: 'disabled' },
]

const roleEditOptions = [
  { label: t('common.role_customer'), value: 'customer' },
  { label: t('common.role_supplier'), value: 'supplier' },
  { label: t('common.role_admin'), value: 'admin' },
]

const userFilterSelect = ref<any>(null)

const { onSelectShow } = useSelectEnterKey([
  {
    selectRef: userFilterSelect,
    getOptions: () => userFilterOptions,
    getLabel: (o) => o.displayName,
    getValue: (o) => o.id,
    onSelect: (v) => {
      filterUserId.value = v
    },
  },
])

function buildFilterParams() {
  return {
    userId: filterUserId.value === ALL ? undefined : filterUserId.value,
    role: filterRole.value === ALL ? undefined : filterRole.value,
    disabled: filterDisabled.value === ALL ? undefined : filterDisabled.value,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
  }
}

const { applyFilters, navigateClear, onPageChange, navigateSort } = useListFilters({
  route: '/admin/users',
  onlyProps: ['users', 'filters'],
  buildParams: buildFilterParams,
  getCurrentPage: () => props.users.meta.currentPage,
})

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

function clearFilters() {
  filterUserId.value = ALL
  filterRole.value = ALL
  filterDisabled.value = ALL
  filterSortBy.value = 'keypadId'
  filterSortOrder.value = 'asc'
  navigateClear()
}

function onSort(event: any) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  navigateSort()
}

function impersonateUser(userId: number) {
  router.post(`/admin/users/${userId}/impersonate`)
}

const inviteForm = useForm({
  email: '',
  role: 'customer' as 'customer' | 'supplier' | 'admin',
  expiresInHours: 168,
})

function createInvite() {
  inviteForm.post('/admin/invitations', {
    preserveScroll: true,
    onSuccess: () => {
      inviteForm.reset('email')
      inviteForm.role = 'customer'
      inviteForm.expiresInHours = 168
    },
  })
}

function revokeInvite(inviteId: number) {
  router.post(`/admin/invitations/${inviteId}/revoke`, {}, { preserveScroll: true })
}
</script>

<template>
  <AppLayout>
    <Head :title="t('admin.users_title')" />
    <ConfirmDialog />

    <h1 class="mb-6 text-2xl font-bold text-gray-900 dark:text-zinc-100">
      {{ t('admin.users_heading') }}
    </h1>

    <div
      class="mb-6 rounded-lg border border-gray-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div class="text-sm text-gray-700 dark:text-zinc-300">
        {{ t('admin.registration_mode_label') }}:
        <strong>{{ t(`admin.registration_mode_${registrationPolicy.mode}`) }}</strong>
      </div>
      <div
        v-if="registrationPolicy.mode === 'domain_auto_approve'"
        class="mt-2 text-sm text-gray-700 dark:text-zinc-300"
      >
        {{ t('admin.registration_allowed_domains') }}:
        <strong>
          {{
            registrationPolicy.allowedDomains.length
              ? registrationPolicy.allowedDomains.join(', ')
              : '—'
          }}
        </strong>
      </div>
    </div>

    <div
      class="mb-6 rounded-lg border border-gray-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
    >
      <h2 class="mb-3 text-lg font-semibold text-gray-900 dark:text-zinc-100">
        {{ t('admin.invites_heading') }}
      </h2>
      <form class="grid gap-3 md:grid-cols-4" @submit.prevent="createInvite">
        <InputText
          v-model="inviteForm.email"
          type="email"
          :placeholder="t('admin.invites_email_placeholder')"
          :invalid="!!inviteForm.errors.email"
        />
        <Select
          v-model="inviteForm.role"
          :options="roleEditOptions"
          optionLabel="label"
          optionValue="value"
        />
        <InputNumber v-model="inviteForm.expiresInHours" :min="1" :max="8760" />
        <Button
          type="submit"
          icon="pi pi-send"
          :label="t('admin.invites_send')"
          :loading="inviteForm.processing"
        />
      </form>

      <div class="mt-4 overflow-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="text-left text-gray-600 dark:text-zinc-300">
              <th class="pb-2">{{ t('admin.invites_email') }}</th>
              <th class="pb-2">{{ t('admin.invites_role') }}</th>
              <th class="pb-2">{{ t('admin.invites_status') }}</th>
              <th class="pb-2">{{ t('admin.invites_expires_at') }}</th>
              <th class="pb-2">{{ t('admin.users_actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="invite in invitations"
              :key="invite.id"
              class="border-t border-gray-200 dark:border-zinc-700"
            >
              <td class="py-2">{{ invite.email }}</td>
              <td class="py-2">{{ t(`auth.invite_role_${invite.role}`) }}</td>
              <td class="py-2">
                <span v-if="invite.acceptedAt">{{ t('admin.invites_status_accepted') }}</span>
                <span v-else-if="invite.revokedAt">{{ t('admin.invites_status_revoked') }}</span>
                <span v-else>{{ t('admin.invites_status_pending') }}</span>
              </td>
              <td class="py-2">{{ invite.expiresAt }}</td>
              <td class="py-2">
                <Button
                  v-if="!invite.acceptedAt && !invite.revokedAt"
                  icon="pi pi-times"
                  severity="danger"
                  size="small"
                  text
                  :label="t('admin.invites_revoke')"
                  @click="revokeInvite(invite.id)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Filter bar -->
    <FilterBar @apply="applyFilters" @clear="clearFilters">
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('admin.users_filter_user')
        }}</label>
        <Select
          ref="userFilterSelect"
          inputId="admin-users-filter-user"
          v-model="filterUserId"
          :options="userFilterOptions"
          optionLabel="displayName"
          optionValue="id"
          filter
          class="w-56"
          @show="onSelectShow"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('admin.users_filter_role')
        }}</label>
        <Select
          inputId="admin-users-filter-role"
          v-model="filterRole"
          :options="roleOptions"
          optionLabel="label"
          optionValue="value"
          class="w-40"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('admin.users_filter_disabled')
        }}</label>
        <Select
          inputId="admin-users-filter-disabled"
          v-model="filterDisabled"
          :options="disabledOptions"
          optionLabel="label"
          optionValue="value"
          class="w-40"
        />
      </div>
    </FilterBar>

    <PaginatedDataTable
      :value="users.data"
      :meta="users.meta"
      :sortField="filterSortBy"
      :sortOrder="sortOrderNum"
      @page="onPageChange"
      @sort="onSort"
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
              icon="pi pi-envelope"
              severity="secondary"
              size="small"
              text
              :aria-label="t('admin.users_send_password_reset')"
              @click="router.post(`/admin/users/${data.id}/send-password-reset`)"
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
    </PaginatedDataTable>
  </AppLayout>
</template>
