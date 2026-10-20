<script setup lang="ts">
import { ref, computed } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Select from 'primevue/select'
import Button from 'primevue/button'
import ConfirmDialog from 'primevue/confirmdialog'
import InfoHint from '~/components/InfoHint.vue'
import { useAppConfirm } from '~/composables/use_app_confirm'
import { useI18n } from '~/composables/use_i18n'
import { formatDate } from '~/composables/use_format_date'
import { useListFilters } from '~/composables/use_list_filters'
import { hasActiveFilters } from '~/composables/use_filter_params'
import { useSelectEnterKey } from '~/composables/use_select_enter_key'
import FilterBar from '~/components/FilterBar.vue'
import PaginatedDataTable from '~/components/PaginatedDataTable.vue'

interface InvoiceRow {
  id: number
  totalCost: number
  isPaid: boolean
  isPaymentRequested: boolean
  createdAt: string
  buyer: { displayName: string }
  supplier: { displayName: string }
  /** The issuer left — the admin confirms or rejects this payment. */
  canSettle: boolean
}

interface PaginatedInvoices {
  data: InvoiceRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
}

const props = defineProps<{
  invoices: PaginatedInvoices
  filters: {
    status: string
    buyerId: string
    supplierId: string
    sortBy: string
    sortOrder: string
  }
  buyers: { id: number; displayName: string }[]
  suppliers: { id: number; displayName: string }[]
}>()
const { t } = useI18n()
const confirm = useAppConfirm()
const ALL = '__all__'

const anySettleable = computed(() => props.invoices.data.some((inv) => inv.canSettle))

function settle(invoice: InvoiceRow, action: 'approve' | 'reject') {
  confirm.require({
    header: t(
      action === 'approve' ? 'admin.invoices_approve_payment' : 'admin.invoices_reject_payment'
    ),
    message: `#${invoice.id} · ${invoice.buyer.displayName} · ${t('common.price_with_currency', { price: invoice.totalCost })}`,
    acceptLabel: t(
      action === 'approve' ? 'admin.invoices_approve_payment' : 'admin.invoices_reject_payment'
    ),
    rejectLabel: t('common.cancel'),
    destructive: action === 'reject',
    accept: () => {
      router.post(`/admin/invoices/${invoice.id}/payment`, { action }, { preserveScroll: true })
    },
  })
}

const filterStatus = ref(props.filters.status || ALL)
const filterBuyerId = ref<number | string>(
  props.filters.buyerId ? Number(props.filters.buyerId) : ALL
)
const filterSupplierId = ref<number | string>(
  props.filters.supplierId ? Number(props.filters.supplierId) : ALL
)
const filterSortBy = ref(props.filters.sortBy || 'createdAt')
const filterSortOrder = ref(props.filters.sortOrder || 'desc')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const statusOptions = [
  { label: t('common.all'), value: ALL },
  { label: t('invoices.filter_paid'), value: 'paid' },
  { label: t('invoices.filter_unpaid'), value: 'unpaid' },
  { label: t('invoices.filter_awaiting'), value: 'awaiting' },
]
const buyerOptions = computed(() => [{ id: ALL, displayName: t('common.all') }, ...props.buyers])
const supplierOptions = computed(() => [
  { id: ALL, displayName: t('common.all') },
  ...props.suppliers,
])
const buyerFilterSelect = ref<any>(null)
const supplierFilterSelect = ref<any>(null)

const { onSelectShow } = useSelectEnterKey([
  {
    selectRef: buyerFilterSelect,
    getOptions: () => buyerOptions.value,
    getLabel: (o) => o.displayName,
    getValue: (o) => o.id,
    onSelect: (v) => {
      filterBuyerId.value = v
      applyFilters()
    },
  },
  {
    selectRef: supplierFilterSelect,
    getOptions: () => supplierOptions.value,
    getLabel: (o) => o.displayName,
    getValue: (o) => o.id,
    onSelect: (v) => {
      filterSupplierId.value = v
      applyFilters()
    },
  },
])

function statusSeverity(inv: InvoiceRow) {
  if (inv.isPaid) return 'success'
  if (inv.isPaymentRequested) return 'warn'
  return 'secondary'
}

function statusLabel(inv: InvoiceRow) {
  if (inv.isPaid) return t('common.paid')
  if (inv.isPaymentRequested) return t('common.awaiting_approval')
  return t('common.unpaid')
}

function buildFilterParams() {
  return {
    status: filterStatus.value === ALL ? undefined : filterStatus.value,
    buyerId: filterBuyerId.value === ALL ? undefined : filterBuyerId.value,
    supplierId: filterSupplierId.value === ALL ? undefined : filterSupplierId.value,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
  }
}

const { applyFilters, navigateClear, onPageChange, navigateSort } = useListFilters({
  route: '/admin/invoices',
  onlyProps: ['invoices', 'filters'],
  buildParams: buildFilterParams,
  getCurrentPage: () => props.invoices.meta.currentPage,
})

const filtersActive = computed(() => hasActiveFilters(buildFilterParams()))

function clearFilters() {
  filterStatus.value = ALL
  filterBuyerId.value = ALL
  filterSupplierId.value = ALL
  filterSortBy.value = 'createdAt'
  filterSortOrder.value = 'desc'
  navigateClear()
}

function onSort(event: any) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  navigateSort()
}
</script>

<template>
  <AppLayout>
    <Head :title="t('admin.invoices_title')" />
    <ConfirmDialog />

    <h1 class="mb-6 text-2xl font-bold text-gray-900 dark:text-zinc-100">
      {{ t('admin.invoices_heading') }}
    </h1>

    <!-- Filter bar -->
    <FilterBar :active="filtersActive" @clear="clearFilters">
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('admin.invoices_filter_status')
        }}</label>
        <Select
          v-model="filterStatus"
          :options="statusOptions"
          optionLabel="label"
          optionValue="value"
          class="w-44"
          @change="applyFilters"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('admin.invoices_filter_customer')
        }}</label>
        <Select
          ref="buyerFilterSelect"
          v-model="filterBuyerId"
          :options="buyerOptions"
          optionLabel="displayName"
          optionValue="id"
          filter
          class="w-56"
          @show="onSelectShow"
          @change="applyFilters"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('admin.invoices_filter_supplier')
        }}</label>
        <Select
          ref="supplierFilterSelect"
          v-model="filterSupplierId"
          :options="supplierOptions"
          optionLabel="displayName"
          optionValue="id"
          filter
          class="w-56"
          @show="onSelectShow"
          @change="applyFilters"
        />
      </div>
    </FilterBar>

    <PaginatedDataTable
      :value="invoices.data"
      :meta="invoices.meta"
      :sortField="filterSortBy"
      :sortOrder="sortOrderNum"
      @page="onPageChange"
      @sort="onSort"
    >
      <Column header="#" headerClass="sbf-col-id" bodyClass="sbf-col-id">
        <template #body="{ data }">{{ data.id }}</template>
      </Column>
      <Column
        :header="t('common.date')"
        field="createdAt"
        sortable
        headerClass="sbf-col-date"
        bodyClass="sbf-col-date"
      >
        <template #body="{ data }">{{ formatDate(data.createdAt) }}</template>
      </Column>
      <Column :header="t('common.customer')" style="min-width: 14rem">
        <template #body="{ data }">{{ data.buyer?.displayName ?? '—' }}</template>
      </Column>
      <Column :header="t('common.supplier')" style="min-width: 14rem">
        <template #body="{ data }">{{ data.supplier?.displayName ?? '—' }}</template>
      </Column>
      <Column
        :header="t('common.total')"
        field="totalCost"
        sortable
        headerClass="sbf-col-price"
        bodyClass="sbf-col-price"
      >
        <template #body="{ data }">
          <span class="font-semibold">{{
            t('common.price_with_currency', { price: data.totalCost })
          }}</span>
        </template>
      </Column>
      <Column :header="t('common.status')" headerClass="sbf-col-tight" bodyClass="sbf-col-tight">
        <template #body="{ data }">
          <Tag
            :value="statusLabel(data)"
            :severity="statusSeverity(data)"
            class="text-xs whitespace-nowrap"
          />
        </template>
      </Column>

      <Column v-if="anySettleable" headerClass="sbf-col-action" bodyClass="sbf-col-action">
        <template #header>
          <span class="flex items-center gap-1">
            {{ t('admin.users_actions') }}
            <InfoHint :text="t('admin.invoices_settle_hint')" />
          </span>
        </template>
        <template #body="{ data }">
          <div v-if="data.canSettle" class="flex items-center gap-1">
            <Button
              icon="pi pi-check"
              severity="success"
              text
              size="small"
              :aria-label="t('admin.invoices_approve_payment')"
              :title="t('admin.invoices_approve_payment')"
              :data-testid="`invoice-approve-${data.id}`"
              @click="settle(data, 'approve')"
            />
            <Button
              v-if="data.isPaymentRequested"
              icon="pi pi-times"
              severity="danger"
              text
              size="small"
              :aria-label="t('admin.invoices_reject_payment')"
              :title="t('admin.invoices_reject_payment')"
              :data-testid="`invoice-reject-${data.id}`"
              @click="settle(data, 'reject')"
            />
          </div>
        </template>
      </Column>

      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('admin.invoices_no_invoices') }}
        </div>
      </template>
    </PaginatedDataTable>
  </AppLayout>
</template>
