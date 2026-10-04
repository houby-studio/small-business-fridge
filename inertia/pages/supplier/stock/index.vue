<script setup lang="ts">
import { ref, computed } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import Select from 'primevue/select'
import InputNumber from 'primevue/inputnumber'
import Dialog from 'primevue/dialog'
import Textarea from 'primevue/textarea'
import { useI18n } from '~/composables/use_i18n'
import { useListFilters } from '~/composables/use_list_filters'
import FilterBar from '~/components/FilterBar.vue'
import InfoHint from '~/components/InfoHint.vue'
import PageTabs from '~/components/PageTabs.vue'
import PaginatedDataTable from '~/components/PaginatedDataTable.vue'
import IncomeLimitBanner, {
  type IncomeLimitStatus,
} from '~/components/supplier/IncomeLimitBanner.vue'
import { useMoney } from '~/composables/use_pricing'
import { WRITE_OFF_REASONS, ADJUSTMENT_NOTE_MAX } from '~/composables/use_shopping_validation'

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

interface StockResult {
  data: StockRow[]
  meta: { total: number; perPage: number; currentPage: number; lastPage: number }
  totals: { totalProducts: number; totalRemaining: number; totalStockValue: number }
  lowStockCount: number
}

type StockScope = 'all' | 'mine'
type StockState = 'all' | 'low' | 'out'

const props = defineProps<{
  stock: StockResult
  categories: Array<{ id: number; name: string; color: string }>
  filters: {
    categoryId: string
    sortBy: string
    sortOrder: string
    scope: StockScope
    stockState: StockState
  }
  openDraftCount: number
  incomeLimit: IncomeLimitStatus | null
}>()

const { t, tp } = useI18n()
const { money } = useMoney()
const ALL = '__all__'

const tabs = computed(() => [
  { label: t('common.tab_stock_state'), url: '/supplier/stock', testId: 'tab-stock-state' },
  {
    label: t('common.tab_stock_history'),
    url: '/supplier/deliveries',
    testId: 'tab-stock-history',
  },
  { label: t('common.tab_inventory'), url: '/supplier/inventory', testId: 'tab-inventory' },
])

// ─── Filters (server-side; `only` keeps shared data off the wire) ─────────────
const filterCategoryId = ref(props.filters.categoryId || ALL)
const filterScope = ref<StockScope>(props.filters.scope === 'mine' ? 'mine' : 'all')
const filterStockState = ref<StockState>(props.filters.stockState || 'all')
const filterSortBy = ref(props.filters.sortBy || 'productName')
const filterSortOrder = ref(props.filters.sortOrder || 'asc')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))

const scopeOptions = computed(() => [
  { label: t('common.scope_all'), value: 'all' },
  { label: t('common.scope_mine'), value: 'mine' },
])
const categoryOptions = computed(() => [
  { label: t('common.all'), value: ALL },
  ...props.categories.map((c) => ({ label: c.name, value: String(c.id) })),
])
const stockStateOptions = computed(() => [
  { label: t('common.all'), value: 'all' },
  { label: t('supplier.stock_state_low', { count: props.stock.lowStockCount }), value: 'low' },
  { label: t('supplier.stock_out_of_stock'), value: 'out' },
])

function buildFilterParams() {
  return {
    categoryId: filterCategoryId.value === ALL ? undefined : filterCategoryId.value,
    scope: filterScope.value === 'all' ? undefined : filterScope.value,
    stockState: filterStockState.value === 'all' ? undefined : filterStockState.value,
    sortBy: filterSortBy.value || undefined,
    sortOrder: filterSortOrder.value || undefined,
  }
}

const { applyFilters, navigateClear, onPageChange, navigateSort } = useListFilters({
  route: '/supplier/stock',
  onlyProps: ['stock', 'filters'],
  buildParams: buildFilterParams,
  getCurrentPage: () => props.stock.meta.currentPage,
})

function clearFilters() {
  filterCategoryId.value = ALL
  filterScope.value = 'all'
  filterStockState.value = 'all'
  filterSortBy.value = 'productName'
  filterSortOrder.value = 'asc'
  navigateClear()
}

function onSort(event: { sortField: string; sortOrder: number }) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  navigateSort()
}

const summary = computed(() =>
  tp('supplier.stock_summary', props.stock.totals.totalProducts, {
    pieces: props.stock.totals.totalRemaining,
    value: money(props.stock.totals.totalStockValue),
  })
)

// ─── Stocking goes through the supplier's draft (příjemka) ────────────────────
function receive(productId?: number) {
  router.post('/supplier/stock/drafts', productId ? { productId } : {})
}

function stockBadgeClass(remaining: number): string {
  if (remaining === 0) return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
  if (remaining <= 4) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
  return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200'
}

// ─── Write-off (pieces you know about: damaged, expired, stolen) ───────────────
type WriteOffReason = (typeof WRITE_OFF_REASONS)[number]
const writeOffVisible = ref(false)
const writeOffTarget = ref<{ productId: number; productName: string; stock: number } | null>(null)
const writeOffQuantity = ref<number | null>(1)
const writeOffReason = ref<WriteOffReason>('expired')
const writeOffNote = ref('')
const writeOffSubmitting = ref(false)
const writeOffReasons = computed(() =>
  WRITE_OFF_REASONS.map((reason) => ({ label: t(`inventory.reason_${reason}`), value: reason }))
)
const writeOffError = computed(() => {
  const target = writeOffTarget.value
  const quantity = writeOffQuantity.value
  if (!target) return ''
  if (!quantity || quantity < 1) return t('inventory.write_off_quantity_min')
  if (quantity > target.stock) return t('inventory.write_off_quantity_max', { max: target.stock })
  return ''
})

function openWriteOff(row: StockRow) {
  writeOffTarget.value = {
    productId: row.productId,
    productName: row.productName,
    stock: row.totalRemaining,
  }
  writeOffQuantity.value = 1
  writeOffReason.value = 'expired'
  writeOffNote.value = ''
  writeOffVisible.value = true
}

function submitWriteOff() {
  if (!writeOffTarget.value || writeOffError.value || writeOffSubmitting.value) return
  writeOffSubmitting.value = true
  router.post(
    '/supplier/stock/write-offs',
    {
      productId: writeOffTarget.value.productId,
      quantity: writeOffQuantity.value,
      reason: writeOffReason.value,
      ...(writeOffNote.value.trim() ? { note: writeOffNote.value.trim() } : {}),
    },
    {
      preserveScroll: true,
      preserveState: true,
      onSuccess: () => {
        writeOffVisible.value = false
      },
      onFinish: () => {
        writeOffSubmitting.value = false
      },
    }
  )
}
</script>

<template>
  <AppLayout>
    <Head :title="t('supplier.stock_title')" />

    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
        {{ t('supplier.stock_title') }}
      </h1>
      <div class="flex flex-wrap items-center gap-3">
        <Link
          v-if="openDraftCount > 0"
          href="/supplier/stock/drafts"
          class="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50"
          data-testid="stock-drafts-waiting"
        >
          {{ tp('supplier.stock_drafts_waiting', openDraftCount) }}
        </Link>
        <Button
          :label="t('supplier.stock_receive')"
          icon="pi pi-plus"
          data-testid="stock-receive"
          @click="receive()"
        />
      </div>
    </div>
    <PageTabs :tabs="tabs" />

    <IncomeLimitBanner v-if="incomeLimit" :status="incomeLimit" class="mb-4" />

    <FilterBar @apply="applyFilters" @clear="clearFilters">
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('common.scope')
        }}</label>
        <Select
          v-model="filterScope"
          :options="scopeOptions"
          optionLabel="label"
          optionValue="value"
          class="w-48"
          data-testid="stock-scope"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('common.category')
        }}</label>
        <Select
          v-model="filterCategoryId"
          :options="categoryOptions"
          optionLabel="label"
          optionValue="value"
          class="w-48"
        />
      </div>
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('supplier.stock_state')
        }}</label>
        <Select
          v-model="filterStockState"
          :options="stockStateOptions"
          optionLabel="label"
          optionValue="value"
          class="w-48"
          data-testid="stock-state"
        />
      </div>
    </FilterBar>

    <p class="mb-2 text-sm text-gray-500 dark:text-zinc-400" data-testid="stock-summary">
      {{ summary }}
    </p>

    <PaginatedDataTable
      :value="stock.data"
      :meta="stock.meta"
      :sortField="filterSortBy"
      :sortOrder="sortOrderNum"
      @page="onPageChange"
      @sort="onSort"
    >
      <Column :header="t('common.product')" field="productName" sortable>
        <template #body="{ data }">
          <div class="flex items-center gap-3">
            <div
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 p-0.5 dark:bg-zinc-800"
            >
              <img
                v-if="data.imagePath"
                :src="data.imagePath"
                :alt="data.productName"
                class="h-full w-full rounded object-contain"
              />
              <span v-else class="pi pi-image text-sm text-gray-300 dark:text-zinc-600" />
            </div>
            <div class="flex min-w-0 flex-col items-start gap-0.5">
              <Link
                :href="`/supplier/products/${data.productId}/edit`"
                class="font-medium text-gray-900 hover:underline dark:text-zinc-100"
                >{{ data.productName }}</Link
              >
              <Tag
                v-if="data.categoryName"
                :value="data.categoryName"
                class="text-xs"
                :style="{ backgroundColor: data.categoryColor, color: '#fff' }"
              />
            </div>
          </div>
        </template>
      </Column>
      <Column
        :header="t('supplier.stock_in_stock')"
        field="totalRemaining"
        sortable
        headerClass="sbf-col-number"
        bodyClass="sbf-col-number"
      >
        <template #body="{ data }">
          <span
            class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
            :class="stockBadgeClass(data.totalRemaining)"
            >{{ data.totalRemaining }} {{ t('common.pieces') }}</span
          >
        </template>
      </Column>
      <Column
        :header="t('supplier.stock_sold_30d')"
        field="soldInPeriod"
        sortable
        headerClass="sbf-col-number"
        bodyClass="sbf-col-number"
      >
        <template #body="{ data }">{{ data.soldInPeriod }} {{ t('common.pieces') }}</template>
      </Column>
      <Column
        :header="t('supplier.stock_stocked')"
        field="totalSupplied"
        sortable
        headerClass="sbf-col-number hidden md:table-cell"
        bodyClass="sbf-col-number hidden md:table-cell"
      >
        <template #body="{ data }">
          <Link
            :href="`/supplier/deliveries?productId=${data.productId}&scope=all`"
            class="hover:underline"
            >{{ data.totalSupplied }} {{ t('common.pieces') }}</Link
          >
        </template>
      </Column>
      <Column
        :header="t('supplier.stock_value')"
        field="totalStockValue"
        sortable
        headerClass="sbf-col-price hidden md:table-cell"
        bodyClass="sbf-col-price hidden md:table-cell"
      >
        <template #body="{ data }">{{ money(data.totalStockValue) }}</template>
      </Column>
      <Column :header="t('common.actions')" headerClass="sbf-col-action" bodyClass="sbf-col-action">
        <template #body="{ data }">
          <div class="flex gap-1">
            <Button
              icon="pi pi-plus"
              severity="secondary"
              text
              size="small"
              :aria-label="t('supplier.stock_receive')"
              data-testid="stock-row-receive"
              @click="receive(data.productId)"
            />
            <Button
              v-if="data.totalRemaining > 0"
              icon="pi pi-minus-circle"
              severity="warn"
              text
              size="small"
              :aria-label="t('inventory.write_off')"
              data-testid="stock-row-write-off"
              @click="openWriteOff(data)"
            />
          </div>
        </template>
      </Column>

      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('supplier.stock_none') }}
        </div>
      </template>
    </PaginatedDataTable>

    <Dialog
      v-model:visible="writeOffVisible"
      :header="t('inventory.write_off_title')"
      style="width: 560px; max-width: calc(100vw - 2rem)"
      modal
      :draggable="false"
      data-testid="write-off-dialog"
    >
      <div v-if="writeOffTarget" class="space-y-4">
        <p class="text-sm text-gray-700 dark:text-zinc-300">
          {{ writeOffTarget.productName }} ·
          {{ t('inventory.write_off_in_stock', { count: writeOffTarget.stock }) }}
        </p>
        <p
          class="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-zinc-400"
          data-testid="write-off-hint"
        >
          {{ t('inventory.write_off_hint') }}
          <InfoHint :text="t('inventory.write_off_fifo')" />
        </p>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
              >{{ t('inventory.write_off_quantity') }} *</label
            >
            <InputNumber
              v-model="writeOffQuantity"
              inputId="write-off-quantity"
              :min="1"
              :max="writeOffTarget.stock"
              fluid
              :invalid="!!writeOffError"
            />
            <small v-if="writeOffError" class="text-red-500 dark:text-red-400">{{
              writeOffError
            }}</small>
          </div>
          <div>
            <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
              >{{ t('inventory.write_off_reason') }} *</label
            >
            <Select
              v-model="writeOffReason"
              :options="writeOffReasons"
              optionLabel="label"
              optionValue="value"
              class="w-full"
            />
          </div>
        </div>
        <div>
          <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
            t('inventory.write_off_note')
          }}</label>
          <Textarea
            v-model="writeOffNote"
            rows="2"
            class="w-full"
            :maxlength="ADJUSTMENT_NOTE_MAX"
            autoResize
          />
        </div>
      </div>
      <template #footer>
        <Button
          :label="t('common.cancel')"
          severity="secondary"
          text
          @click="writeOffVisible = false"
        />
        <Button
          :label="t('inventory.write_off_confirm')"
          severity="danger"
          :disabled="!!writeOffError || writeOffSubmitting"
          :loading="writeOffSubmitting"
          data-testid="write-off-confirm"
          @click="submitWriteOff"
        />
      </template>
    </Dialog>
  </AppLayout>
</template>
