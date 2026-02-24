<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Select from 'primevue/select'
import InputNumber from 'primevue/inputnumber'
import { useI18n } from '~/composables/use_i18n'
import { areFilterParamsEqual } from '~/composables/use_filter_params'
import { formatDate } from '~/composables/use_format_date'

interface StockRow {
  productId: number
  productName: string
  imagePath: string | null
  categoryName: string | null
  categoryColor: string | null
  totalSupplied: number
  totalRemaining: number
  totalSold: number
  soldInPeriod: number
  deliveredInPeriod: number
  deliveryCount: number
  totalStockValue: number
}

interface CategoryBreakdownRow {
  categoryName: string | null
  categoryColor: string | null
  totalRemaining: number
  productCount: number
}

interface StockResult {
  data: StockRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
  totals: { totalProducts: number; totalRemaining: number; totalStockValue: number }
  insights: {
    lowStockCount: number
    activeProducts: number
    period: '30d'
    categoryBreakdown: CategoryBreakdownRow[]
    lowStockItems: StockRow[]
    topMovers: StockRow[]
  }
}

interface CategoryOption {
  id: number
  name: string
  color: string
}

interface ProductOption {
  id: number
  displayName: string
}

interface RecentDeliveryRow {
  id: number
  createdAt: string
  amountSupplied: number
  amountLeft: number
  price: number
  productName: string
  supplierName: string
}

const props = defineProps<{
  stock: StockResult
  recentDeliveries: RecentDeliveryRow[]
  categories: CategoryOption[]
  products: ProductOption[]
  preselect: number | null
  filters: {
    categoryId: string
    sortBy: string
    sortOrder: string
    scope: string
  }
}>()

const { t } = useI18n()
const ALL = '__all__'

const filterCategoryId = ref(props.filters.categoryId || ALL)
const filterSortBy = ref(props.filters.sortBy || 'productName')
const filterSortOrder = ref(props.filters.sortOrder || 'asc')
const filterScope = ref(props.filters.scope === 'mine' ? 'mine' : 'store')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const selectedProduct = ref<number | null>(props.preselect ?? null)
const amount = ref<number | null>(null)
const price = ref<number | null>(null)
const submitting = ref(false)
const showFullTable = ref(false)
const amountInput = ref<any>(null)

const categoryOptions = computed(() => [
  { label: t('common.all'), value: ALL },
  ...props.categories.map((c) => ({ label: c.name, value: String(c.id) })),
])

const quickProductOptions = computed(() =>
  props.products.map((p) => ({ label: p.displayName, value: Number(p.id) }))
)

const scopeOptions = computed(() => [
  { label: t('supplier.stock_scope_store'), value: 'store' },
  { label: t('supplier.stock_scope_mine'), value: 'mine' },
])

const insightPeriodLabel = computed(() => t('supplier.stock_period_30d'))

function focusAmountField() {
  const el = amountInput.value?.$el as HTMLElement | undefined
  const input = el?.querySelector('input') as HTMLInputElement | null
  input?.focus()
}

onMounted(() => {
  if (props.preselect) {
    nextTick(() => {
      focusAmountField()
    })
  }
})

function buildFilterParams() {
  return {
    categoryId: filterCategoryId.value === ALL ? undefined : filterCategoryId.value,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
    scope: filterScope.value === 'store' ? undefined : filterScope.value,
  }
}

const lastAppliedFilterParams = ref(buildFilterParams())

function applyFilters() {
  const nextParams = buildFilterParams()
  const page = areFilterParamsEqual(nextParams, lastAppliedFilterParams.value)
    ? props.stock.meta.currentPage
    : 1
  router.get(
    '/supplier/stock',
    { ...nextParams, page },
    { preserveState: true, only: ['stock', 'filters', 'recentDeliveries'] }
  )
  lastAppliedFilterParams.value = nextParams
}

function clearFilters() {
  filterCategoryId.value = ALL
  filterSortBy.value = 'productName'
  filterSortOrder.value = 'asc'
  filterScope.value = 'store'
  lastAppliedFilterParams.value = buildFilterParams()
  router.get('/supplier/stock', buildFilterParams(), {
    preserveState: true,
    only: ['stock', 'filters', 'recentDeliveries'],
  })
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

function submitQuickDelivery() {
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
            :label="t('supplier.stock_delivery_history')"
            icon="pi pi-box"
            size="small"
            severity="secondary"
          />
        </Link>
      </div>
    </div>
    <p class="mb-4 text-sm text-gray-500 dark:text-zinc-400">
      {{ t('supplier.stock_scope_hint') }}
    </p>

    <Card class="mb-6">
      <template #content>
        <form
          @submit.prevent="submitQuickDelivery"
          class="grid grid-cols-1 items-end gap-2 lg:grid-cols-12"
        >
          <div class="min-w-0 lg:col-span-6">
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
              t('supplier.deliveries_product')
            }}</label>
            <Select
              v-model="selectedProduct"
              fluid
              :options="quickProductOptions"
              optionLabel="label"
              optionValue="value"
              :placeholder="t('supplier.deliveries_product')"
              filter
            />
          </div>
          <div class="min-w-0 lg:col-span-2">
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
              t('supplier.deliveries_amount')
            }}</label>
            <InputNumber
              ref="amountInput"
              v-model="amount"
              fluid
              :min="1"
              :placeholder="t('common.pieces')"
            />
          </div>
          <div class="lg:col-span-2">
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-zinc-300">{{
              t('supplier.deliveries_price')
            }}</label>
            <InputNumber
              v-model="price"
              fluid
              :min="1"
              :suffix="' ' + t('common.currency')"
              :placeholder="t('common.currency')"
            />
          </div>
          <div class="lg:col-span-2 lg:flex lg:justify-end">
            <Button
              type="submit"
              fluid
              :label="t('supplier.deliveries_submit')"
              icon="pi pi-plus"
              :loading="submitting"
              :disabled="!selectedProduct || !amount || !price"
            />
          </div>
        </form>
      </template>
    </Card>

    <!-- Summary cards (totals across all filtered results) -->
    <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                {{ t('common.price_with_currency', { price: stock.totals.totalStockValue }) }}
              </div>
              <div class="text-sm text-gray-500 dark:text-zinc-400">
                {{ t('supplier.stock_total_value') }}
              </div>
            </div>
          </div>
        </template>
      </Card>
      <Card class="sbf-stat sbf-stat-amber">
        <template #content>
          <div class="flex items-center gap-4">
            <div
              class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-950/40"
            >
              <span class="pi pi-exclamation-triangle text-xl text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <div class="text-3xl font-bold text-amber-600 dark:text-amber-400">
                {{ stock.insights.lowStockCount }}
              </div>
              <div class="text-sm text-gray-500 dark:text-zinc-400">
                {{ t('supplier.stock_low_stock') }}
              </div>
            </div>
          </div>
        </template>
      </Card>
      <Card class="sbf-stat sbf-stat-blue">
        <template #content>
          <div class="flex items-center gap-4">
            <div
              class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-950/40"
            >
              <span class="pi pi-check-circle text-xl text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <div class="text-3xl font-bold text-blue-600 dark:text-blue-400">
                {{ stock.insights.activeProducts }}
              </div>
              <div class="text-sm text-gray-500 dark:text-zinc-400">
                {{ t('supplier.stock_in_stock_types') }}
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
          t('supplier.stock_scope')
        }}</label>
        <Select
          v-model="filterScope"
          :options="scopeOptions"
          optionLabel="label"
          optionValue="value"
          class="w-44"
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

    <Card class="mb-6">
      <template #title>{{ t('supplier.stock_category_breakdown') }}</template>
      <template #content>
        <DataTable
          :value="stock.insights.categoryBreakdown"
          :paginator="false"
          size="small"
          stripedRows
          class="rounded-lg border"
        >
          <Column :header="t('common.category')">
            <template #body="{ data }">
              <Tag
                :value="data.categoryName || t('supplier.stock_uncategorized')"
                class="text-xs"
                :style="{
                  backgroundColor: data.categoryColor || '#6b7280',
                  color: '#fff',
                }"
              />
            </template>
          </Column>
          <Column :header="t('supplier.stock_in_stock')" style="width: 150px">
            <template #body="{ data }">{{ data.totalRemaining }} {{ t('common.pieces') }}</template>
          </Column>
          <Column :header="t('supplier.stock_types_count')" style="width: 150px">
            <template #body="{ data }">{{ data.productCount }}</template>
          </Column>
          <template #empty>
            <div class="py-4 text-center text-gray-500 dark:text-zinc-400">
              {{ t('common.no_data') }}
            </div>
          </template>
        </DataTable>
      </template>
    </Card>

    <div class="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <template #title>{{ t('supplier.stock_attention') }}</template>
        <template #subtitle>{{
          t('supplier.stock_period_hint', { period: insightPeriodLabel })
        }}</template>
        <template #content>
          <DataTable
            :value="stock.insights.lowStockItems"
            :paginator="false"
            size="small"
            stripedRows
            class="rounded-lg border"
          >
            <Column :header="t('common.product')">
              <template #body="{ data }">{{ data.productName }}</template>
            </Column>
            <Column :header="t('supplier.stock_in_stock')" style="width: 120px">
              <template #body="{ data }">
                <Tag
                  :value="`${data.totalRemaining} ${t('common.pieces')}`"
                  :severity="stockSeverity(data.totalRemaining)"
                  class="text-xs"
                />
              </template>
            </Column>
            <Column :header="t('supplier.stock_sold_period')" style="width: 140px">
              <template #body="{ data }">{{ data.soldInPeriod }} {{ t('common.pieces') }}</template>
            </Column>
            <template #empty>
              <div class="py-4 text-center text-gray-500 dark:text-zinc-400">
                {{ t('supplier.stock_no_attention_period', { period: insightPeriodLabel }) }}
              </div>
            </template>
          </DataTable>
        </template>
      </Card>

      <Card>
        <template #title>{{ t('supplier.stock_top_movers') }}</template>
        <template #subtitle>{{
          t('supplier.stock_period_hint', { period: insightPeriodLabel })
        }}</template>
        <template #content>
          <DataTable
            :value="stock.insights.topMovers"
            :paginator="false"
            size="small"
            stripedRows
            class="rounded-lg border"
          >
            <Column :header="t('common.product')">
              <template #body="{ data }">{{ data.productName }}</template>
            </Column>
            <Column :header="t('supplier.stock_sold_period')" style="width: 140px">
              <template #body="{ data }">{{ data.soldInPeriod }} {{ t('common.pieces') }}</template>
            </Column>
            <template #empty>
              <div class="py-4 text-center text-gray-500 dark:text-zinc-400">
                {{ t('supplier.stock_no_movers_period', { period: insightPeriodLabel }) }}
              </div>
            </template>
          </DataTable>
        </template>
      </Card>
    </div>

    <Card class="mb-6">
      <template #title>{{ t('supplier.deliveries_recent') }}</template>
      <template #content>
        <DataTable
          :value="recentDeliveries"
          :paginator="false"
          size="small"
          stripedRows
          class="rounded-lg border"
        >
          <Column :header="t('common.date')" style="width: 140px">
            <template #body="{ data }">{{ formatDate(data.createdAt) }}</template>
          </Column>
          <Column :header="t('common.product')">
            <template #body="{ data }">{{ data.productName }}</template>
          </Column>
          <Column
            v-if="filterScope === 'store'"
            :header="t('common.supplier')"
            style="width: 180px"
          >
            <template #body="{ data }">{{ data.supplierName }}</template>
          </Column>
          <Column :header="t('supplier.deliveries_amount')" style="width: 120px">
            <template #body="{ data }">{{ data.amountSupplied }} {{ t('common.pieces') }}</template>
          </Column>
          <Column :header="t('supplier.deliveries_remaining')" style="width: 120px">
            <template #body="{ data }">{{ data.amountLeft }} {{ t('common.pieces') }}</template>
          </Column>
          <Column :header="t('common.price')" style="width: 120px">
            <template #body="{ data }">{{
              t('common.price_with_currency', { price: data.price })
            }}</template>
          </Column>
          <template #empty>
            <div class="py-4 text-center text-gray-500 dark:text-zinc-400">
              {{ t('supplier.deliveries_none') }}
            </div>
          </template>
        </DataTable>
      </template>
    </Card>

    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-lg font-semibold text-gray-800 dark:text-zinc-200">
        {{ t('supplier.stock_full_table') }}
      </h2>
      <Button
        :label="showFullTable ? t('supplier.stock_hide_table') : t('supplier.stock_show_table')"
        :icon="showFullTable ? 'pi pi-eye-slash' : 'pi pi-table'"
        size="small"
        severity="secondary"
        @click="showFullTable = !showFullTable"
      />
    </div>

    <DataTable
      v-if="showFullTable"
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
            <div
              class="flex h-9 w-9 items-center justify-center rounded-md bg-gray-100 p-0.5 dark:bg-zinc-800"
            >
              <img
                v-if="data.imagePath"
                :src="data.imagePath"
                :alt="data.productName"
                class="h-full w-full rounded object-contain"
              />
              <span v-else class="pi pi-image text-sm text-gray-300 dark:text-zinc-600" />
            </div>
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
      <Column :header="t('supplier.stock_total_value')" style="width: 120px">
        <template #body="{ data }">
          <span class="font-semibold">{{
            t('common.price_with_currency', { price: data.totalStockValue })
          }}</span>
        </template>
      </Column>
      <Column :header="t('common.actions')" style="width: 130px">
        <template #body="{ data }">
          <div class="flex gap-1">
            <Link :href="`/supplier/stock?preselect=${data.productId}`">
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
