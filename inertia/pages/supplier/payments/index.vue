<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Select from 'primevue/select'
import ConfirmDialog from 'primevue/confirmdialog'
import { useAppConfirm } from '~/composables/use_app_confirm'
import { useI18n } from '~/composables/use_i18n'
import { formatDate } from '~/composables/use_format_date'
import { useListFilters } from '~/composables/use_list_filters'
import { hasActiveFilters } from '~/composables/use_filter_params'
import { useSelectEnterKey } from '~/composables/use_select_enter_key'
import { useMoney } from '~/composables/use_pricing'
import FilterBar from '~/components/FilterBar.vue'
import InfoHint from '~/components/InfoHint.vue'
import PaginatedDataTable from '~/components/PaginatedDataTable.vue'

interface InvoiceRow {
  id: number
  totalCost: number
  isPaid: boolean
  isPaymentRequested: boolean
  createdAt: string
  buyer: { displayName: string }
}

interface PaginatedInvoices {
  data: InvoiceRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
}

const props = defineProps<{
  invoices: PaginatedInvoices
  filters: { status: string; sortBy: string; sortOrder: string; buyerId: string }
  buyers: { id: number; displayName: string }[]
  reviewInvoice: { id: number; totalCost: number; buyerName: string } | null
}>()
const { t } = useI18n()
const { amount, money } = useMoney()
const confirm = useAppConfirm()
const ALL = '__all__'

const filterStatus = ref(props.filters.status || ALL)
const filterSortBy = ref(props.filters.sortBy || 'createdAt')
const filterSortOrder = ref(props.filters.sortOrder || 'desc')
const filterBuyerId = ref<number | string>(
  props.filters.buyerId ? Number(props.filters.buyerId) : ALL
)
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const buyerOptions = [{ id: ALL, displayName: t('common.all') }, ...props.buyers]

const buyerFilterSelect = ref<any>(null)

const { onSelectShow } = useSelectEnterKey([
  {
    selectRef: buyerFilterSelect,
    getOptions: () => buyerOptions,
    getLabel: (o) => o.displayName,
    getValue: (o) => o.id,
    onSelect: (v) => {
      filterBuyerId.value = v
      applyFilters()
    },
  },
])

const statusOptions = [
  { label: t('common.all'), value: ALL },
  { label: t('invoices.filter_paid'), value: 'paid' },
  { label: t('invoices.filter_unpaid'), value: 'unpaid' },
  { label: t('invoices.filter_awaiting'), value: 'awaiting' },
]

// Status badge colours from CLAUDE.md › Status Badges.
function statusClass(invoice: InvoiceRow) {
  if (invoice.isPaid) return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200'
  if (invoice.isPaymentRequested)
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
  return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
}

function statusLabel(invoice: InvoiceRow) {
  if (invoice.isPaid) return t('common.paid')
  if (invoice.isPaymentRequested) return t('common.awaiting_approval')
  return t('common.unpaid')
}

onMounted(() => {
  if (props.reviewInvoice) {
    const inv = props.reviewInvoice
    confirm.require({
      message: t('supplier.review_payment_message', {
        buyer: inv.buyerName,
        id: inv.id,
        amount: amount(inv.totalCost),
      }),
      header: t('supplier.review_payment_header'),
      icon: 'pi pi-credit-card',
      acceptLabel: t('supplier.payments_approve'),
      rejectLabel: t('common.cancel'),
      accept: () => approve(inv.id),
    })
  }
})

// The server redirects back to the referer, so filters and the current page survive the
// action; preserveScroll keeps the viewport where the supplier was working instead of
// jumping back to the top of the list.
// One request at a time: a double click must not approve or reject twice.
const processingId = ref<number | null>(null)
const processingAction = ref<'approve' | 'reject' | null>(null)

function process(id: number, action: 'approve' | 'reject') {
  if (processingId.value !== null) return
  processingId.value = id
  processingAction.value = action
  router.post(
    `/supplier/payments/${id}`,
    { action },
    {
      preserveScroll: true,
      onFinish: () => {
        processingId.value = null
        processingAction.value = null
      },
    }
  )
}

function approve(id: number) {
  process(id, 'approve')
}

/** Rejecting e-mails the buyer, so it is confirmed first. */
function reject(invoice: InvoiceRow) {
  confirm.require({
    message: t('supplier.payments_reject_confirm', {
      buyer: invoice.buyer?.displayName ?? '—',
      amount: money(invoice.totalCost),
    }),
    header: t('supplier.payments_reject'),
    acceptLabel: t('supplier.payments_reject'),
    rejectLabel: t('common.cancel'),
    destructive: true,
    accept: () => process(invoice.id, 'reject'),
  })
}

function buildFilterParams() {
  return {
    status: filterStatus.value === ALL ? undefined : filterStatus.value,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
    buyerId: filterBuyerId.value === ALL ? undefined : filterBuyerId.value,
  }
}

const { applyFilters, navigateClear, onPageChange, navigateSort } = useListFilters({
  route: '/supplier/payments',
  onlyProps: ['invoices', 'filters'],
  buildParams: buildFilterParams,
  getCurrentPage: () => props.invoices.meta.currentPage,
})

const filtersActive = computed(() => hasActiveFilters(buildFilterParams()))

function clearFilters() {
  filterStatus.value = ALL
  filterSortBy.value = 'createdAt'
  filterSortOrder.value = 'desc'
  filterBuyerId.value = ALL
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
    <Head :title="t('supplier.payments_title')" />
    <ConfirmDialog />

    <div class="mb-6 flex items-center gap-1">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
        {{ t('supplier.payments_title') }}
      </h1>
      <InfoHint :text="t('supplier.payments_order_hint')" test-id="payments-order-hint" />
    </div>

    <!-- Filter bar -->
    <FilterBar :active="filtersActive" @clear="clearFilters">
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('supplier.payments_filter_status')
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
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('supplier.payments_filter_customer')
        }}</label>
        <Select
          ref="buyerFilterSelect"
          v-model="filterBuyerId"
          :options="buyerOptions"
          optionLabel="displayName"
          optionValue="id"
          filter
          class="w-48"
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
      <Column :header="t('common.customer')">
        <template #body="{ data }">{{ data.buyer?.displayName ?? '—' }}</template>
      </Column>
      <Column
        :header="t('common.total')"
        field="totalCost"
        sortable
        headerClass="sbf-col-price"
        bodyClass="sbf-col-price"
      >
        <template #body="{ data }">
          <span class="font-semibold">{{ money(data.totalCost) }}</span>
        </template>
      </Column>
      <Column :header="t('common.status')" headerClass="sbf-col-tight" bodyClass="sbf-col-tight">
        <template #body="{ data }">
          <span
            class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
            :class="statusClass(data)"
            data-testid="payment-status"
            >{{ statusLabel(data) }}</span
          >
        </template>
      </Column>
      <Column :header="t('common.actions')" headerClass="sbf-col-action" bodyClass="sbf-col-action">
        <template #body="{ data }">
          <div class="flex gap-1">
            <Button
              v-if="!data.isPaid"
              :label="t('supplier.payments_approve')"
              icon="pi pi-check"
              size="small"
              severity="success"
              :loading="processingId === data.id && processingAction === 'approve'"
              :disabled="processingId !== null"
              data-testid="payment-approve"
              @click="approve(data.id)"
            />
            <Button
              v-if="data.isPaymentRequested && !data.isPaid"
              :label="t('supplier.payments_reject')"
              icon="pi pi-times"
              size="small"
              severity="danger"
              outlined
              :loading="processingId === data.id && processingAction === 'reject'"
              :disabled="processingId !== null"
              data-testid="payment-reject"
              @click="reject(data)"
            />
          </div>
        </template>
      </Column>

      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('supplier.payments_no_invoices') }}
        </div>
      </template>
    </PaginatedDataTable>
  </AppLayout>
</template>
