<script setup lang="ts">
import { computed, ref } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import FilterBar from '~/components/FilterBar.vue'
import InfoHint from '~/components/InfoHint.vue'
import PaginatedDataTable from '~/components/PaginatedDataTable.vue'
import IncomeLimitBanner, {
  type IncomeLimitStatus,
} from '~/components/supplier/IncomeLimitBanner.vue'
import { useI18n } from '~/composables/use_i18n'
import { useMoney } from '~/composables/use_pricing'
import { MAX_MARGIN_PERCENT, type LossReason } from '~/composables/use_shopping_validation'

/** Mirrors `FinanceSummary` in app/services/finance_service.ts. */
interface Summary {
  year: number
  unitsSold: number
  revenue: number
  unitsWithCost: number
  revenueWithCost: number
  costOfSales: number
  grossProfit: number
  achievedMarginPercent: number | null
  unitsWithoutCost: number
  ownConsumption: { units: number; value: number }
  shrinkage: {
    lostUnits: number
    surplusUnits: number
    surplusCost: number
    lossCost: number
    lossValue: number
    lossRate: number
    byReason: Array<{ reason: LossReason; lostUnits: number; lossCost: number; lossValue: number }>
  }
  netProfit: number
  breakEvenMarginPercent: number
  marginPercent: number
  incomeLimit: IncomeLimitStatus
}

interface ProductRow {
  productId: number
  productName: string
  unitsSold: number
  revenue: number
  unitsWithCost: number
  costOfSales: number
  grossProfit: number | null
  lostUnits: number
  lossCost: number
  lossRate: number
}

const props = defineProps<{
  summary: Summary
  products: {
    data: ProductRow[]
    meta: { total: number; perPage: number; currentPage: number; lastPage: number }
  }
  years: number[]
  filters: { year: string; sortBy: string; sortOrder: string }
}>()

const { t } = useI18n()
const { money, percent } = useMoney()

const filterYear = ref(Number(props.filters.year))
const filterSortBy = ref(props.filters.sortBy || 'revenue')
const filterSortOrder = ref(props.filters.sortOrder || 'desc')
const sortOrderNum = computed(() => (filterSortOrder.value === 'asc' ? 1 : -1))
const yearOptions = computed(() =>
  props.years.map((year) => ({ label: String(year), value: year }))
)

function params(extra: Record<string, unknown> = {}) {
  return {
    year: filterYear.value,
    sortBy: filterSortBy.value,
    sortOrder: filterSortOrder.value,
    ...extra,
  }
}

function applyFilters() {
  router.get('/supplier/finance', params({ page: 1 }), {
    preserveState: true,
    only: ['summary', 'products', 'filters'],
  })
}

function clearFilters() {
  filterYear.value = props.years[0]
  applyFilters()
}

function onPage(event: { page: number }) {
  router.get('/supplier/finance', params({ page: event.page + 1 }), {
    preserveState: true,
    preserveScroll: true,
    only: ['products', 'filters'],
  })
}

function onSort(event: { sortField: string; sortOrder: number }) {
  filterSortBy.value = event.sortField
  filterSortOrder.value = event.sortOrder === 1 ? 'asc' : 'desc'
  router.get('/supplier/finance', params({ page: 1 }), {
    preserveState: true,
    preserveScroll: true,
    only: ['products', 'filters'],
  })
}

const profitClass = (value: number) =>
  value < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'

// ─── Margin (a setting, so it lives in a dialog behind the cog) ────────────────
const marginVisible = ref(false)
const marginValue = ref<number | null>(props.summary.marginPercent)
const marginSubmitting = ref(false)
const marginError = computed(() =>
  marginValue.value === null || marginValue.value < 0 || marginValue.value > MAX_MARGIN_PERCENT
    ? t('finance.margin_invalid', { max: MAX_MARGIN_PERCENT })
    : ''
)

function openMargin() {
  marginValue.value = props.summary.marginPercent
  marginVisible.value = true
}

function useBreakEven() {
  marginValue.value = Math.ceil(props.summary.breakEvenMarginPercent * 10) / 10
}

function saveMargin() {
  if (marginError.value || marginSubmitting.value) return
  marginSubmitting.value = true
  router.put(
    '/supplier/finance/settings',
    { marginPercent: marginValue.value },
    {
      preserveScroll: true,
      onSuccess: () => {
        marginVisible.value = false
      },
      onFinish: () => {
        marginSubmitting.value = false
      },
    }
  )
}

// The margin the supplier really made is what has to cover the shrinkage — not the one
// configured for new prices.
const marginBelowBreakEven = computed(
  () =>
    props.summary.achievedMarginPercent !== null &&
    props.summary.breakEvenMarginPercent > 0 &&
    props.summary.achievedMarginPercent < props.summary.breakEvenMarginPercent
)

const reasonLabel = (reason: LossReason) => t(`inventory.reason_${reason}`)
const hasShrinkageBreakdown = computed(
  () => props.summary.shrinkage.byReason.length > 0 || props.summary.shrinkage.surplusUnits > 0
)
</script>

<template>
  <AppLayout>
    <Head :title="t('finance.title')" />

    <div class="mb-6 flex items-center justify-between gap-3">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
        {{ t('finance.heading') }}
      </h1>
      <Button
        icon="pi pi-cog"
        severity="secondary"
        text
        :aria-label="t('finance.margin_settings')"
        data-testid="finance-margin-edit"
        @click="openMargin"
      />
    </div>

    <FilterBar @apply="applyFilters" @clear="clearFilters">
      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300">{{
          t('finance.year')
        }}</label>
        <Select
          v-model="filterYear"
          :options="yearOptions"
          optionLabel="label"
          optionValue="value"
          class="w-48"
          data-testid="finance-year"
        />
      </div>
    </FilterBar>

    <IncomeLimitBanner :status="summary.incomeLimit" always class="mb-4" />

    <div
      class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5"
      data-testid="finance-kpis"
    >
      <Card>
        <template #content>
          <div
            class="text-2xl font-bold text-gray-900 dark:text-zinc-100"
            data-testid="finance-revenue"
          >
            {{ money(summary.revenue) }}
          </div>
          <div class="text-sm text-gray-500 dark:text-zinc-400">
            {{ t('finance.revenue', { count: summary.unitsSold }) }}
          </div>
          <div
            v-if="summary.ownConsumption.units > 0"
            class="mt-1 text-xs text-gray-500 dark:text-zinc-400"
            data-testid="finance-own-consumption"
          >
            {{
              t('finance.own_consumption', {
                count: summary.ownConsumption.units,
                amount: money(summary.ownConsumption.value),
              })
            }}
          </div>
        </template>
      </Card>
      <Card>
        <template #content>
          <div class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
            {{ money(summary.costOfSales) }}
          </div>
          <div class="text-sm text-gray-500 dark:text-zinc-400">
            {{ t('finance.cost_of_sales') }}
          </div>
          <div
            v-if="summary.unitsWithoutCost > 0"
            class="mt-1 inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"
            data-testid="finance-units-without-cost"
          >
            {{ t('finance.units_without_cost', { count: summary.unitsWithoutCost }) }}
            <InfoHint :text="t('finance.units_without_cost_hint')" />
          </div>
        </template>
      </Card>
      <Card>
        <template #content>
          <div
            class="text-2xl font-bold text-gray-900 dark:text-zinc-100"
            data-testid="finance-gross-profit"
          >
            {{ money(summary.grossProfit) }}
          </div>
          <div class="text-sm text-gray-500 dark:text-zinc-400">
            {{ t('finance.gross_profit') }}
            <template v-if="summary.achievedMarginPercent !== null">
              ·
              {{ t('finance.achieved_margin', { margin: percent(summary.achievedMarginPercent) }) }}
            </template>
          </div>
        </template>
      </Card>
      <Card>
        <template #content>
          <div
            class="text-2xl font-bold"
            :class="profitClass(summary.netProfit)"
            data-testid="finance-net-profit"
          >
            {{ money(summary.netProfit) }}
          </div>
          <div class="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-zinc-400">
            {{ t('finance.net_profit_title') }}
            <InfoHint :text="t('finance.net_profit_hint')" test-id="finance-net-profit-hint" />
          </div>
        </template>
      </Card>
      <Card>
        <template #content>
          <div
            class="text-2xl font-bold text-red-600 dark:text-red-400"
            data-testid="finance-shrinkage"
          >
            {{ money(summary.shrinkage.lossCost) }}
          </div>
          <div class="text-sm text-gray-500 dark:text-zinc-400">
            {{
              t('finance.shrinkage', {
                count: summary.shrinkage.lostUnits - summary.shrinkage.surplusUnits,
                rate: percent(summary.shrinkage.lossRate * 100),
              })
            }}
          </div>
          <div
            class="mt-1 text-xs text-gray-500 dark:text-zinc-400"
            data-testid="finance-shrinkage-value"
          >
            {{ t('finance.shrinkage_value', { amount: money(summary.shrinkage.lossValue) }) }}
          </div>
        </template>
      </Card>
    </div>

    <h2 class="mb-3 text-lg font-semibold text-gray-800 dark:text-zinc-200">
      {{ t('finance.products_heading') }}
    </h2>
    <PaginatedDataTable
      :value="products.data"
      :meta="products.meta"
      :sortField="filterSortBy"
      :sortOrder="sortOrderNum"
      dataKey="productId"
      class="mb-6"
      @page="onPage"
      @sort="onSort"
    >
      <Column :header="t('common.product')" field="productName" sortable>
        <template #body="{ data }">{{ data.productName }}</template>
      </Column>
      <Column :header="t('finance.col_units')" field="unitsSold" sortable>
        <template #body="{ data }">{{ data.unitsSold }} {{ t('common.pieces') }}</template>
      </Column>
      <Column :header="t('finance.col_revenue')" field="revenue" sortable>
        <template #body="{ data }">{{ money(data.revenue) }}</template>
      </Column>
      <Column :header="t('finance.col_cost')">
        <template #body="{ data }">{{
          data.unitsWithCost ? money(data.costOfSales) : '—'
        }}</template>
      </Column>
      <Column :header="t('finance.col_profit')" field="grossProfit" sortable>
        <template #body="{ data }">
          <span
            :class="
              data.grossProfit !== null && data.grossProfit < 0
                ? 'text-red-600 dark:text-red-400'
                : ''
            "
            >{{ money(data.grossProfit) }}</span
          >
        </template>
      </Column>
      <Column :header="t('finance.col_lost')" field="lostUnits" sortable>
        <template #body="{ data }">
          <span v-if="data.lostUnits"
            >{{ data.lostUnits }} {{ t('common.pieces') }} ({{
              percent(data.lossRate * 100)
            }})</span
          >
          <span v-else>—</span>
        </template>
      </Column>
      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('common.no_data') }}
        </div>
      </template>
    </PaginatedDataTable>

    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold text-gray-800 dark:text-zinc-200">
        {{ t('finance.shrinkage_by_reason') }}
      </h2>
      <Link
        href="/supplier/deliveries?type=adjustments&scope=mine"
        class="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline dark:text-zinc-400"
        data-testid="finance-history-link"
      >
        {{ t('finance.history_link') }}
        <span class="pi pi-arrow-right text-xs" aria-hidden="true" />
      </Link>
    </div>
    <div
      v-if="hasShrinkageBreakdown"
      class="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
      data-testid="finance-shrinkage-by-reason"
    >
      <div
        v-for="row in summary.shrinkage.byReason"
        :key="row.reason"
        class="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        :data-testid="`finance-reason-${row.reason}`"
      >
        <div class="text-sm text-gray-700 dark:text-zinc-300">{{ reasonLabel(row.reason) }}</div>
        <div class="text-lg font-semibold text-red-600 dark:text-red-400">
          {{ money(row.lossCost) }}
        </div>
        <div class="text-xs text-gray-500 dark:text-zinc-400">
          {{
            t('finance.shrinkage_by_reason_line', {
              count: row.lostUnits,
              value: money(row.lossValue),
            })
          }}
        </div>
      </div>
      <!-- Surplus found by inventories offsets the losses above, so the cards add up to the KPI. -->
      <div
        v-if="summary.shrinkage.surplusUnits > 0"
        class="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        data-testid="finance-surplus"
      >
        <div class="text-sm text-gray-700 dark:text-zinc-300">{{ t('finance.surplus') }}</div>
        <div class="text-lg font-semibold text-green-700 dark:text-green-300">
          +{{ money(summary.shrinkage.surplusCost) }}
        </div>
        <div class="text-xs text-gray-500 dark:text-zinc-400">
          {{ t('finance.surplus_line', { count: summary.shrinkage.surplusUnits }) }}
        </div>
      </div>
    </div>
    <div
      v-else
      class="mb-6 rounded-lg border border-dashed border-gray-300 py-6 text-center text-sm text-gray-500 dark:border-zinc-700 dark:text-zinc-400"
    >
      {{ t('common.no_data') }}
    </div>

    <Dialog
      v-model:visible="marginVisible"
      :header="t('finance.margin_dialog_title')"
      :style="{ width: '28rem' }"
      modal
      :draggable="false"
      data-testid="finance-margin-dialog"
    >
      <div class="space-y-3">
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt class="text-gray-500 dark:text-zinc-400">{{ t('finance.margin_current') }}</dt>
          <dd
            class="text-right font-semibold text-gray-900 dark:text-zinc-100"
            data-testid="finance-margin"
          >
            {{ percent(summary.marginPercent, 2) }}
          </dd>
          <dt class="text-gray-500 dark:text-zinc-400">{{ t('finance.margin_achieved') }}</dt>
          <dd
            class="text-right font-semibold text-gray-900 dark:text-zinc-100"
            data-testid="finance-margin-achieved"
          >
            {{
              summary.achievedMarginPercent === null
                ? '—'
                : percent(summary.achievedMarginPercent, 2)
            }}
          </dd>
        </dl>
        <p
          v-if="marginBelowBreakEven"
          class="text-sm text-amber-700 dark:text-amber-300"
          data-testid="finance-margin-warning"
        >
          {{ t('finance.margin_below_break_even') }}
        </p>
        <div>
          <label
            for="finance-margin-input"
            class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
            >{{ t('finance.margin_label') }} *</label
          >
          <InputNumber
            v-model="marginValue"
            inputId="finance-margin-input"
            :min="0"
            :max="MAX_MARGIN_PERCENT"
            :minFractionDigits="0"
            :maxFractionDigits="2"
            suffix=" %"
            fluid
            :invalid="!!marginError"
          />
          <small v-if="marginError" class="text-red-500 dark:text-red-400">{{ marginError }}</small>
        </div>
        <p class="text-sm text-gray-500 dark:text-zinc-400" data-testid="finance-margin-help">
          {{ t('finance.margin_help') }}
        </p>
        <Button
          v-if="summary.breakEvenMarginPercent > 0"
          :label="
            t('finance.margin_use_break_even', {
              margin: percent(summary.breakEvenMarginPercent, 2),
              rate: percent(summary.shrinkage.lossRate * 100),
            })
          "
          icon="pi pi-arrow-circle-down"
          severity="secondary"
          size="small"
          data-testid="finance-break-even"
          @click="useBreakEven"
        />
      </div>
      <template #footer>
        <Button
          :label="t('common.cancel')"
          severity="secondary"
          text
          @click="marginVisible = false"
        />
        <Button
          :label="t('common.save')"
          :disabled="!!marginError || marginSubmitting"
          :loading="marginSubmitting"
          data-testid="finance-margin-save"
          @click="saveMargin"
        />
      </template>
    </Dialog>
  </AppLayout>
</template>
