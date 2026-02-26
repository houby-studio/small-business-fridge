<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import Select from 'primevue/select'
import ConfirmDialog from 'primevue/confirmdialog'
import { useConfirm } from 'primevue/useconfirm'
import { useI18n } from '~/composables/use_i18n'
import { formatDate } from '~/composables/use_format_date'
import { useListFilters } from '~/composables/use_list_filters'
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
const confirm = useConfirm()
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
    },
  },
])

const statusOptions = [
  { label: t('common.all'), value: ALL },
  { label: t('invoices.filter_paid'), value: 'paid' },
  { label: t('invoices.filter_unpaid'), value: 'unpaid' },
  { label: t('invoices.filter_awaiting'), value: 'awaiting' },
]

function statusSeverity(invoice: InvoiceRow) {
  if (invoice.isPaid) return 'success'
  if (invoice.isPaymentRequested) return 'warn'
  return 'secondary'
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
        amount: inv.totalCost,
      }),
      header: t('supplier.review_payment_header'),
      icon: 'pi pi-credit-card',
      acceptLabel: t('supplier.payments_approve'),
      rejectLabel: t('common.cancel'),
      accept: () => approve(inv.id),
    })
  }
})

function approve(id: number) {
  router.post(`/supplier/payments/${id}`, { action: 'approve' })
}

function reject(id: number) {
  router.post(`/supplier/payments/${id}`, { action: 'reject' })
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

    <h1 class="mb-6 text-2xl font-bold text-gray-900 dark:text-zinc-100">
      {{ t('supplier.payments_heading') }}
    </h1>

    <!-- Filter bar -->
    <FilterBar @apply="applyFilters" @clear="clearFilters">
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('supplier.payments_filter_status')
        }}</label>
        <Select
          v-model="filterStatus"
          :options="statusOptions"
          optionLabel="label"
          optionValue="value"
          class="w-44"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
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
      <Column :header="t('common.actions')" headerClass="sbf-col-action" bodyClass="sbf-col-action">
        <template #body="{ data }">
          <div class="flex gap-1">
            <Button
              v-if="!data.isPaid"
              :label="t('supplier.payments_approve')"
              icon="pi pi-check"
              size="small"
              severity="success"
              @click="approve(data.id)"
            />
            <Button
              v-if="data.isPaymentRequested && !data.isPaid"
              :label="t('supplier.payments_reject')"
              icon="pi pi-times"
              size="small"
              severity="danger"
              outlined
              @click="reject(data.id)"
            />
            <Tag
              v-if="data.isPaid"
              :value="t('common.approved')"
              severity="success"
              class="text-xs"
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
