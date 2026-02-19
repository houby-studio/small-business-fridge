<script setup lang="ts">
import { ref, computed } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import { useI18n } from '~/composables/use_i18n'

interface StockRow {
  productId: number
  productName: string
  imagePath: string | null
  categoryName: string | null
  categoryColor: string | null
  totalSupplied: number
  totalRemaining: number
  totalSold: number
  deliveryCount: number
  totalRevenue: number
}

interface StockResult {
  data: StockRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
  totals: { totalProducts: number; totalRemaining: number; totalRevenue: number }
}

interface CategoryOption {
  id: number
  name: string
  color: string
}

const props = defineProps<{
  stock: StockResult
  categories: CategoryOption[]
  filters: { name: string; categoryId: string; inStock: string; sortBy: string; sortOrder: string }
}>()

const { t } = useI18n()

const filterName = ref(props.filters.name)
const filterCategoryId = ref(props.filters.categoryId)
const filterInStock = ref(props.filters.inStock === '1')
const filterSortBy = ref(props.filters.sortBy || 'productName')
const filterSortOrder = ref(props.filters.sortOrder || 'asc')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const categoryOptions = computed(() => [
  { label: t('common.all'), value: '' },
  ...props.categories.map((c) => ({ label: c.name, value: String(c.id) })),
])

function buildFilterParams() {
  return {
    name: filterName.value || undefined,
    categoryId: filterCategoryId.value || undefined,
    inStock: filterInStock.value ? '1' : undefined,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
  }
}

function applyFilters() {
  router.get(
    '/supplier/stock',
    { ...buildFilterParams(), page: 1 },
    { preserveState: true, only: ['stock', 'filters'] }
  )
}

function clearFilters() {
  filterName.value = ''
  filterCategoryId.value = ''
  filterInStock.value = false
  filterSortBy.value = 'productName'
  filterSortOrder.value = 'asc'
  router.get('/supplier/stock', {}, { preserveState: true, only: ['stock', 'filters'] })
}

function onPageChange(event: any) {
  router.get(
    '/supplier/stock',
    { ...buildFilterParams(), page: event.page + 1 },
    { preserveState: true, only: ['stock', 'filters'] }
  )
}

function onSort(event: any) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  router.get(
    '/supplier/stock',
    {
      ...buildFilterParams(),
      sortBy: event.sortField,
      sortOrder: event.sortOrder === 1 ? 'asc' : 'desc',
      page: 1,
    },
    { preserveState: true, only: ['stock', 'filters'] }
  )
}

function stockSeverity(remaining: number): 'success' | 'warn' | 'danger' {
  if (remaining >= 5) return 'success'
  if (remaining > 0) return 'warn'
  return 'danger'
}
</script>

<template>
  <AppLayout>
    <Head :title="t('supplier.stock_title')" />

    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
        {{ t('supplier.stock_heading') }}
      </h1>
      <div class="flex gap-2">
        <Link href="/supplier/products/new">
          <Button :label="t('supplier.stock_new_product')" icon="pi pi-plus" size="small" />
        </Link>
        <Link href="/supplier/deliveries">
          <Button
            :label="t('supplier.deliveries_submit')"
            icon="pi pi-box"
            size="small"
            severity="secondary"
          />
        </Link>
      </div>
    </div>

    <!-- Summary cards (totals across all filtered results) -->
    <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card class="sbf-stat sbf-stat-primary">
        <template #content>
          <div class="flex items-center gap-4">
            <div
              class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-red-100 dark:bg-red-950/40"
            >
              <span class="pi pi-tags text-xl text-primary" />
            </div>
            <div>
              <div class="text-3xl font-bold text-gray-900 dark:text-zinc-100">
                {{ stock.totals.totalProducts }}
              </div>
              <div class="text-sm text-gray-500 dark:text-zinc-400">
                {{ t('supplier.stock_products') }}
              </div>
            </div>
          </div>
        </template>
      </Card>
      <Card class="sbf-stat sbf-stat-green">
        <template #content>
          <div class="flex items-center gap-4">
            <div
              class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-green-100 dark:bg-green-950/40"
            >
              <span class="pi pi-warehouse text-xl text-green-600 dark:text-green-400" />
            </div>
            <div>
              <div class="text-3xl font-bold text-gray-900 dark:text-zinc-100">
                {{ stock.totals.totalRemaining }}
                <span class="text-lg font-medium">{{ t('common.pieces') }}</span>
              </div>
              <div class="text-sm text-gray-500 dark:text-zinc-400">
                {{ t('supplier.stock_total_in_stock') }}
              </div>
            </div>
          </div>
        </template>
      </Card>
      <Card class="sbf-stat sbf-stat-purple">
        <template #content>
          <div class="flex items-center gap-4">
            <div
              class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-950/40"
            >
              <span class="pi pi-chart-bar text-xl text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <div class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
                {{ t('common.price_with_currency', { price: stock.totals.totalRevenue }) }}
              </div>
              <div class="text-sm text-gray-500 dark:text-zinc-400">
                {{ t('supplier.stock_total_revenue') }}
              </div>
            </div>
          </div>
        </template>
      </Card>
    </div>

    <!-- Filter bar -->
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('supplier.stock_filter_name')
        }}</label>
        <InputText
          v-model="filterName"
          :placeholder="t('supplier.stock_filter_name')"
          class="w-48"
          @keyup.enter="applyFilters"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-600 dark:text-zinc-400">{{
          t('common.category')
        }}</label>
        <Select
          v-model="filterCategoryId"
          :options="categoryOptions"
          optionLabel="label"
          optionValue="value"
          class="w-44"
        />
      </div>
      <div class="flex items-center gap-2 pb-0.5">
        <Checkbox v-model="filterInStock" inputId="inStockCheck" binary />
        <label for="inStockCheck" class="cursor-pointer text-sm text-gray-600 dark:text-zinc-400">{{
          t('supplier.stock_filter_in_stock')
        }}</label>
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

    <!-- Stock table -->
    <DataTable
      :value="stock.data"
      :paginator="stock.meta.lastPage > 1"
      :rows="stock.meta.perPage"
      :totalRecords="stock.meta.total"
      :lazy="true"
      :first="(stock.meta.currentPage - 1) * stock.meta.perPage"
      :sortField="filterSortBy"
      :sortOrder="sortOrderNum"
      @page="onPageChange"
      @sort="onSort"
      stripedRows
      class="rounded-lg border"
    >
      <Column :header="t('common.product')" field="productName" sortable>
        <template #body="{ data }">
          <div class="flex items-center gap-3">
            <img
              v-if="data.imagePath"
              :src="data.imagePath"
              :alt="data.productName"
              class="h-8 w-8 rounded object-cover"
            />
            <div>
              <div class="font-medium">{{ data.productName }}</div>
              <Tag
                v-if="data.categoryName"
                :value="data.categoryName"
                class="mt-0.5 text-xs"
                :style="{ backgroundColor: data.categoryColor, color: '#fff' }"
              />
            </div>
          </div>
        </template>
      </Column>
      <Column :header="t('supplier.stock_stocked')" style="width: 120px">
        <template #body="{ data }">{{ data.totalSupplied }} {{ t('common.pieces') }}</template>
      </Column>
      <Column
        :header="t('supplier.stock_in_stock')"
        field="totalRemaining"
        sortable
        style="width: 130px"
      >
        <template #body="{ data }">
          <Tag
            :value="`${data.totalRemaining} ${t('common.pieces')}`"
            :severity="stockSeverity(data.totalRemaining)"
            class="text-xs"
          />
        </template>
      </Column>
      <Column :header="t('supplier.stock_sold')" field="totalSold" sortable style="width: 120px">
        <template #body="{ data }">{{ data.totalSold }} {{ t('common.pieces') }}</template>
      </Column>
      <Column :header="t('supplier.stock_total_revenue')" style="width: 120px">
        <template #body="{ data }">
          <span class="font-semibold">{{
            t('common.price_with_currency', { price: data.totalRevenue })
          }}</span>
        </template>
      </Column>
      <Column :header="t('common.actions')" style="width: 130px">
        <template #body="{ data }">
          <div class="flex gap-1">
            <Link :href="`/supplier/deliveries?preselect=${data.productId}`">
              <Button
                icon="pi pi-box"
                :aria-label="t('supplier.deliveries_submit')"
                size="small"
                severity="secondary"
                text
              />
            </Link>
            <Link :href="`/supplier/products/${data.productId}/edit`">
              <Button
                icon="pi pi-pencil"
                :aria-label="t('common.edit')"
                size="small"
                severity="secondary"
                text
              />
            </Link>
          </div>
        </template>
      </Column>

      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('supplier.stock_none') }}
        </div>
      </template>
    </DataTable>
  </AppLayout>
</template>
