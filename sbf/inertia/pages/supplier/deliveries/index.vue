<script setup lang="ts">
import { ref, computed } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Select from 'primevue/select'
import InputNumber from 'primevue/inputnumber'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Card from 'primevue/card'
import { useI18n } from '~/composables/use_i18n'
import { formatDate } from '~/composables/use_format_date'

interface ProductOption {
  id: number
  displayName: string
  imagePath: string | null
  category: { name: string; color: string } | null
}

interface DeliveryRow {
  id: number
  amountSupplied: number
  amountLeft: number
  price: number
  createdAt: string
  product: { displayName: string; category?: { name: string } }
}

interface PaginatedDeliveries {
  data: DeliveryRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
}

const props = defineProps<{
  products: ProductOption[]
  recentDeliveries: PaginatedDeliveries
  filters: { productId: string; sortBy: string; sortOrder: string }
  preselect: number | null
}>()

const { t } = useI18n()

const selectedProduct = ref<number | null>(props.preselect ?? null)
const amount = ref<number | null>(null)
const price = ref<number | null>(null)
const submitting = ref(false)

const filterProductId = ref(props.filters.productId)
const filterSortBy = ref(props.filters.sortBy || 'createdAt')
const filterSortOrder = ref(props.filters.sortOrder || 'desc')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const productFilterOptions = computed(() => [
  { label: t('common.all'), value: '' },
  ...props.products.map((p) => ({ label: p.displayName, value: String(p.id) })),
])

function submit() {
  if (!selectedProduct.value || !amount.value || !price.value) return
  submitting.value = true
  router.post(
    '/supplier/deliveries',
    {
      productId: selectedProduct.value,
      amount: amount.value,
      price: price.value,
    },
    {
      onFinish: () => {
        submitting.value = false
        selectedProduct.value = null
        amount.value = null
        price.value = null
      },
    }
  )
}

function buildFilterParams() {
  return {
    productId: filterProductId.value || undefined,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
  }
}

function applyFilters() {
  router.get(
    '/supplier/deliveries',
    { ...buildFilterParams(), page: 1 },
    { preserveState: true, only: ['recentDeliveries', 'filters'] }
  )
}

function clearFilters() {
  filterProductId.value = ''
  filterSortBy.value = 'createdAt'
  filterSortOrder.value = 'desc'
  router.get(
    '/supplier/deliveries',
    {},
    { preserveState: true, only: ['recentDeliveries', 'filters'] }
  )
}

function onPageChange(event: any) {
  router.get(
    '/supplier/deliveries',
    { ...buildFilterParams(), page: event.page + 1 },
    { preserveState: true, only: ['recentDeliveries', 'filters'] }
  )
}

function onSort(event: any) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  router.get(
    '/supplier/deliveries',
    {
      ...buildFilterParams(),
      sortBy: event.sortField,
      sortOrder: event.sortOrder === 1 ? 'asc' : 'desc',
      page: 1,
    },
    { preserveState: true, only: ['recentDeliveries', 'filters'] }
  )
}
</script>

<template>
  <AppLayout>
    <Head :title="t('supplier.deliveries_title')" />

    <h1 class="mb-6 text-2xl font-bold text-gray-900 dark:text-zinc-100">
      {{ t('supplier.deliveries_heading') }}
    </h1>

    <!-- Add stock form -->
    <Card class="mb-8">
      <template #content>
        <form @submit.prevent="submit" class="flex flex-wrap items-end gap-4">
          <div class="min-w-[250px] flex-1">
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
              t('supplier.deliveries_product')
            }}</label>
            <Select
              v-model="selectedProduct"
              :options="products"
              optionLabel="displayName"
              optionValue="id"
              :placeholder="t('supplier.deliveries_product')"
              filter
              class="w-full"
            />
          </div>
          <div class="w-32">
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
              t('supplier.deliveries_amount')
            }}</label>
            <InputNumber
              v-model="amount"
              :min="1"
              :placeholder="t('common.pieces')"
              class="w-full"
            />
          </div>
          <div class="w-32">
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
              t('supplier.deliveries_price')
            }}</label>
            <InputNumber
              v-model="price"
              :min="1"
              :suffix="' ' + t('common.currency')"
              :placeholder="t('common.currency')"
              class="w-full"
            />
          </div>
          <Button
            type="submit"
            :label="t('supplier.deliveries_submit')"
            icon="pi pi-plus"
            :loading="submitting"
            :disabled="!selectedProduct || !amount || !price"
          />
        </form>
      </template>
    </Card>

    <!-- Recent deliveries -->
    <h2 class="mb-4 text-lg font-semibold text-gray-800 dark:text-zinc-200">
      {{ t('supplier.deliveries_recent') }}
    </h2>

    <!-- Filter bar -->
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('supplier.deliveries_filter_product')
        }}</label>
        <Select
          v-model="filterProductId"
          :options="productFilterOptions"
          optionLabel="label"
          optionValue="value"
          class="w-52"
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
      :value="recentDeliveries.data"
      :paginator="recentDeliveries.meta.lastPage > 1"
      :rows="recentDeliveries.meta.perPage"
      :totalRecords="recentDeliveries.meta.total"
      :lazy="true"
      :first="(recentDeliveries.meta.currentPage - 1) * recentDeliveries.meta.perPage"
      :sortField="filterSortBy"
      :sortOrder="sortOrderNum"
      @page="onPageChange"
      @sort="onSort"
      stripedRows
      class="rounded-lg border"
    >
      <Column :header="t('common.date')" field="createdAt" sortable>
        <template #body="{ data }">{{ formatDate(data.createdAt) }}</template>
      </Column>
      <Column :header="t('common.product')">
        <template #body="{ data }">{{ data.product?.displayName ?? '—' }}</template>
      </Column>
      <Column :header="t('supplier.deliveries_amount')" style="width: 100px">
        <template #body="{ data }">{{ data.amountSupplied }} {{ t('common.pieces') }}</template>
      </Column>
      <Column :header="t('supplier.deliveries_remaining')" style="width: 100px">
        <template #body="{ data }">{{ data.amountLeft }} {{ t('common.pieces') }}</template>
      </Column>
      <Column :header="t('common.price')" field="price" sortable style="width: 100px">
        <template #body="{ data }">{{
          t('common.price_with_currency', { price: data.price })
        }}</template>
      </Column>

      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('supplier.deliveries_none') }}
        </div>
      </template>
    </DataTable>
  </AppLayout>
</template>
