<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Column from 'primevue/column'
import ConfirmDialog from 'primevue/confirmdialog'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import Textarea from 'primevue/textarea'
import FilterBar from '~/components/FilterBar.vue'
import InfoHint from '~/components/InfoHint.vue'
import PageTabs from '~/components/PageTabs.vue'
import PaginatedDataTable from '~/components/PaginatedDataTable.vue'
import { useI18n } from '~/composables/use_i18n'
import { useAppConfirm } from '~/composables/use_app_confirm'
import { useMoney } from '~/composables/use_pricing'
import { formatDate } from '~/composables/use_format_date'
import { ADJUSTMENT_NOTE_MAX } from '~/composables/use_shopping_validation'

interface CountableProduct {
  productId: number
  productName: string
  imagePath: string | null
  categoryName: string | null
  categoryColor: string | null
  stock: number
}

type InventoryScope = 'mine' | 'all'
type CountsWho = 'mine' | 'all'

interface CountRow {
  id: number
  createdAt: string
  actorName: string
  scope: InventoryScope
  note: string | null
  products: number
  lossQuantity: number
  surplusQuantity: number
  lossValue: number
  lossCost: number
}

const props = defineProps<{
  products: CountableProduct[]
  categories: Array<{ id: number; name: string; color: string }>
  counts: {
    data: CountRow[]
    meta: { total: number; perPage: number; currentPage: number; lastPage: number }
  }
  filters: { scope: InventoryScope; categoryId: string; who: CountsWho }
}>()

const { t } = useI18n()
const { money } = useMoney()
const confirm = useAppConfirm()

const tabs = computed(() => [
  { label: t('common.tab_stock_state'), url: '/supplier/stock', testId: 'tab-stock-state' },
  {
    label: t('common.tab_stock_history'),
    url: '/supplier/deliveries',
    testId: 'tab-stock-history',
  },
  { label: t('common.tab_inventory'), url: '/supplier/inventory', testId: 'tab-inventory' },
])

// ─── Sheet filters (what gets counted) ─────────────────────────────────────────
const ALL = '__all__'
const filterScope = ref<InventoryScope>(props.filters.scope === 'all' ? 'all' : 'mine')
const filterCategoryId = ref(props.filters.categoryId || ALL)
const filterWho = ref<CountsWho>(props.filters.who === 'all' ? 'all' : 'mine')
const scopeOptions = computed(() => [
  { label: t('common.scope_all'), value: 'all' },
  { label: t('common.scope_mine'), value: 'mine' },
])
const categoryOptions = computed(() => [
  { label: t('common.all'), value: ALL },
  ...props.categories.map((c) => ({ label: c.name, value: String(c.id) })),
])
const whoOptions = computed(() => [
  { label: t('inventory.who_mine'), value: 'mine' },
  { label: t('inventory.who_all'), value: 'all' },
])

function buildParams() {
  return {
    scope: filterScope.value === 'mine' ? undefined : filterScope.value,
    categoryId: filterCategoryId.value === ALL ? undefined : filterCategoryId.value,
    who: filterWho.value === 'mine' ? undefined : filterWho.value,
  }
}

function applyFilters() {
  router.get('/supplier/inventory', buildParams(), {
    preserveState: true,
    only: ['products', 'filters'],
  })
}

function clearFilters() {
  filterScope.value = 'mine'
  filterCategoryId.value = ALL
  applyFilters()
}

// ─── Past inventories (below the sheet; partial reload only) ──────────────────
function reloadCounts(page: number) {
  router.get(
    '/supplier/inventory',
    { ...buildParams(), page },
    { preserveState: true, preserveScroll: true, only: ['counts', 'filters'] }
  )
}

function onCountsPage(event: { page: number }) {
  reloadCounts(event.page + 1)
}

function onWhoChange() {
  reloadCounts(1)
}

// What the counter saw per product when they counted — sales afterwards are not shrinkage.
const counted = reactive<Record<number, number | null>>({})
const expectedAtCount = reactive<Record<number, number>>({})
const note = ref('')
const submitting = ref(false)

watch(
  () => props.products,
  (products) => {
    const ids = new Set(products.map((p) => p.productId))
    for (const key of Object.keys(counted)) {
      if (!ids.has(Number(key))) delete counted[Number(key)]
    }
  }
)

function setCounted(product: CountableProduct, value: number | null) {
  counted[product.productId] = value
  if (value === null) delete expectedAtCount[product.productId]
  else expectedAtCount[product.productId] = product.stock
}

function markMatches(product: CountableProduct) {
  setCounted(product, product.stock)
}

function difference(product: CountableProduct): number | null {
  const value = counted[product.productId]
  if (value === null || value === undefined) return null
  return value - (expectedAtCount[product.productId] ?? product.stock)
}

const entries = computed(() =>
  props.products
    .filter((p) => counted[p.productId] !== null && counted[p.productId] !== undefined)
    .map((p) => ({
      productId: p.productId,
      expected: expectedAtCount[p.productId] ?? p.stock,
      counted: counted[p.productId] as number,
    }))
)
const summary = computed(() => {
  let missing = 0
  let extra = 0
  for (const entry of entries.value) {
    const diff = entry.counted - entry.expected
    if (diff < 0) missing += -diff
    else extra += diff
  }
  return { products: entries.value.length, missing, extra }
})

function submit() {
  if (submitting.value || entries.value.length === 0) return
  confirm.require({
    header: t('inventory.commit_title'),
    message: t('inventory.commit_message', {
      missing: summary.value.missing,
      extra: summary.value.extra,
    }),
    acceptLabel: t('inventory.commit'),
    rejectLabel: t('common.cancel'),
    accept: () => {
      submitting.value = true
      router.post(
        '/supplier/inventory',
        {
          // The sheet shows the applied scope, not an unapplied change in the filter bar.
          scope: props.filters.scope,
          ...(note.value.trim() ? { note: note.value.trim() } : {}),
          items: entries.value,
        },
        {
          onFinish: () => {
            submitting.value = false
          },
        }
      )
    },
  })
}

function diffClass(diff: number | null) {
  if (diff === null || diff === 0) return 'text-gray-500 dark:text-zinc-400'
  return diff < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'
}
</script>

<template>
  <AppLayout>
    <Head :title="t('inventory.title')" />
    <ConfirmDialog />

    <h1 class="mb-3 text-2xl font-bold text-gray-900 dark:text-zinc-100">
      {{ t('supplier.stock_title') }}
    </h1>
    <PageTabs :tabs="tabs" />

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
          data-testid="inventory-scope"
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
    </FilterBar>

    <Card class="mb-6">
      <template #content>
        <div class="space-y-1" data-testid="inventory-sheet">
          <div
            v-for="product in products"
            :key="product.productId"
            class="flex flex-wrap items-center gap-3 rounded-md px-2 py-2 odd:bg-gray-50 dark:odd:bg-zinc-800/50"
            :data-testid="`inventory-row-${product.productId}`"
          >
            <div class="min-w-0 flex-1">
              <div class="font-medium text-gray-900 dark:text-zinc-100">
                {{ product.productName }}
              </div>
              <Tag
                v-if="product.categoryName"
                :value="product.categoryName"
                class="mt-0.5 text-xs"
                :style="{ backgroundColor: product.categoryColor || '#6b7280', color: '#fff' }"
              />
            </div>
            <div class="w-28 text-sm text-gray-600 dark:text-zinc-300">
              {{ t('inventory.expected', { count: product.stock }) }}
            </div>
            <InputNumber
              :modelValue="counted[product.productId] ?? null"
              :min="0"
              :max="100000"
              :inputId="`inventory-counted-${product.productId}`"
              :aria-label="t('inventory.counted_for', { name: product.productName })"
              :placeholder="t('inventory.counted_placeholder')"
              inputClass="w-24"
              @update:modelValue="(value: number | null) => setCounted(product, value)"
            />
            <Button
              icon="pi pi-check"
              severity="secondary"
              text
              size="small"
              :aria-label="t('inventory.matches', { name: product.productName })"
              :data-testid="`inventory-matches-${product.productId}`"
              @click="markMatches(product)"
            />
            <div
              class="w-20 text-right text-sm font-semibold"
              :class="diffClass(difference(product))"
              :data-testid="`inventory-diff-${product.productId}`"
            >
              {{
                difference(product) === null
                  ? '—'
                  : difference(product)! > 0
                    ? `+${difference(product)}`
                    : difference(product)
              }}
            </div>
          </div>
          <div
            v-if="products.length === 0"
            class="py-8 text-center text-gray-500 dark:text-zinc-400"
          >
            {{ t('inventory.no_products') }}
          </div>
        </div>

        <div class="mt-4">
          <label for="inventory-note" class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
            t('inventory.note')
          }}</label>
          <Textarea
            id="inventory-note"
            v-model="note"
            rows="2"
            autoResize
            class="w-full"
            :maxlength="ADJUSTMENT_NOTE_MAX"
          />
        </div>

        <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span class="text-sm text-gray-700 dark:text-zinc-300" data-testid="inventory-summary">{{
            t('inventory.summary', {
              products: summary.products,
              missing: summary.missing,
              extra: summary.extra,
            })
          }}</span>
          <span class="inline-flex items-center gap-1">
            <Button
              :label="t('inventory.commit')"
              icon="pi pi-check"
              :disabled="entries.length === 0 || submitting"
              :loading="submitting"
              data-testid="inventory-commit"
              @click="submit"
            />
            <InfoHint
              mode="dialog"
              :title="t('inventory.commit')"
              :text="t('inventory.commit_hint')"
              test-id="inventory-commit-hint"
            />
          </span>
        </div>
      </template>
    </Card>

    <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
      <h2 class="text-lg font-semibold text-gray-800 dark:text-zinc-200">
        {{ t('inventory.history') }}
      </h2>
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('inventory.counted_by')
        }}</label>
        <Select
          v-model="filterWho"
          :options="whoOptions"
          optionLabel="label"
          optionValue="value"
          class="w-48"
          data-testid="inventory-who"
          @change="onWhoChange"
        />
      </div>
    </div>
    <PaginatedDataTable :value="counts.data" :meta="counts.meta" @page="onCountsPage">
      <Column :header="t('common.date')">
        <template #body="{ data }">
          <Link :href="`/supplier/inventory/${data.id}`" class="underline">{{
            formatDate(data.createdAt)
          }}</Link>
        </template>
      </Column>
      <Column :header="t('inventory.counted_by')">
        <template #body="{ data }">{{ data.actorName }}</template>
      </Column>
      <Column :header="t('inventory.products_counted')">
        <template #body="{ data }">{{ data.products }}</template>
      </Column>
      <Column :header="t('inventory.missing')">
        <template #body="{ data }">
          <span :class="data.lossQuantity ? 'text-red-600 dark:text-red-400' : ''"
            >{{ data.lossQuantity }} {{ t('common.pieces') }}</span
          >
        </template>
      </Column>
      <Column :header="t('inventory.extra')">
        <template #body="{ data }">{{ data.surplusQuantity }} {{ t('common.pieces') }}</template>
      </Column>
      <Column :header="t('inventory.loss_cost')">
        <template #body="{ data }">{{ money(data.lossCost) }}</template>
      </Column>
      <Column :header="t('inventory.loss_value')">
        <template #body="{ data }">{{ money(data.lossValue) }}</template>
      </Column>
      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('inventory.history_empty') }}
        </div>
      </template>
    </PaginatedDataTable>
  </AppLayout>
</template>
