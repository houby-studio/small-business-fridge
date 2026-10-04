<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Head, Link, router } from '@inertiajs/vue3'
import AppLayout from '~/layouts/AppLayout.vue'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Select from 'primevue/select'
import { useI18n } from '~/composables/use_i18n'
import { useMoney } from '~/composables/use_pricing'
import { formatDate } from '~/composables/use_format_date'
import { LOSS_REASONS, type LossReason } from '~/composables/use_shopping_validation'

interface Adjustment {
  id: number
  productId: number
  supplierName: string
  kind: 'loss' | 'surplus'
  reason: LossReason
  quantity: number
  unitCost: number | null
  unitPrice: number
}

const props = defineProps<{
  count: {
    id: number
    createdAt: string
    actorName: string
    scope: 'mine' | 'all'
    note: string | null
    items: Array<{
      productId: number
      productName: string
      expectedQty: number
      countedQty: number
      appliedQty: number
    }>
    adjustments: Adjustment[]
  }
}>()

const { t } = useI18n()
const { money } = useMoney()

// The lots an inventory touched are audit detail — folded away until asked for.
const lotsVisible = ref(false)

const productName = computed(
  () => new Map(props.count.items.map((item) => [item.productId, item.productName]))
)
const changedItems = computed(() => props.count.items.filter((item) => item.appliedQty !== 0))
const totals = computed(() => {
  let lossValue = 0
  let lossCost = 0
  for (const a of props.count.adjustments) {
    const sign = a.kind === 'loss' ? 1 : -1
    lossValue += sign * a.quantity * a.unitPrice
    lossCost += sign * a.quantity * (a.unitCost ?? a.unitPrice)
  }
  return { lossValue, lossCost: Math.round(lossCost * 100) / 100 }
})

// ─── Why the pieces are missing ────────────────────────────────────────────────
// All loss rows of a product share one reason (they are reclassified together).
const savedReasons = computed(() => {
  const reasons = new Map<number, LossReason>()
  for (const a of props.count.adjustments) {
    if (a.kind === 'loss' && !reasons.has(a.productId)) reasons.set(a.productId, a.reason)
  }
  return reasons
})
const reasons = reactive<Record<number, LossReason>>({})
watch(
  savedReasons,
  (saved) => {
    for (const [productId, reason] of saved) reasons[productId] = reason
  },
  { immediate: true }
)
const reasonOptions = computed(() =>
  LOSS_REASONS.map((reason) => ({ label: t(`inventory.reason_${reason}`), value: reason }))
)
const savingProductId = ref<number | null>(null)

function changeReason(productId: number, reason: LossReason) {
  if (savingProductId.value !== null || reason === savedReasons.value.get(productId)) return
  reasons[productId] = reason
  savingProductId.value = productId
  router.put(
    `/supplier/inventory/${props.count.id}/products/${productId}`,
    { reason },
    {
      preserveScroll: true,
      preserveState: true,
      onFinish: () => {
        savingProductId.value = null
        // A refused change snaps back to what is stored.
        const saved = savedReasons.value.get(productId)
        if (saved) reasons[productId] = saved
      },
    }
  )
}

function adjustmentReason(adjustment: Adjustment) {
  return adjustment.kind === 'surplus'
    ? t('inventory.reason_surplus')
    : t(`inventory.reason_${adjustment.reason}`)
}

function diffClass(diff: number) {
  if (diff === 0) return 'text-gray-500 dark:text-zinc-400'
  return diff < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'
}
</script>

<template>
  <AppLayout>
    <Head :title="t('inventory.detail_title', { id: count.id })" />

    <div class="mb-2 flex items-center gap-2">
      <Link href="/supplier/inventory">
        <Button icon="pi pi-arrow-left" severity="secondary" text :aria-label="t('common.back')" />
      </Link>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
        {{ t('inventory.detail_title', { id: count.id }) }}
      </h1>
    </div>
    <p class="mb-6 text-sm text-gray-500 dark:text-zinc-400">
      {{ formatDate(count.createdAt) }} · {{ count.actorName }} ·
      {{ t(`common.scope_${count.scope}`) }}
      <template v-if="count.note"> · {{ count.note }}</template>
    </p>

    <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card>
        <template #content>
          <div class="text-2xl font-bold text-gray-900 dark:text-zinc-100">
            {{ count.items.length }}
          </div>
          <div class="text-sm text-gray-500 dark:text-zinc-400">
            {{ t('inventory.products_counted') }}
          </div>
        </template>
      </Card>
      <Card>
        <template #content>
          <div
            class="text-2xl font-bold text-red-600 dark:text-red-400"
            data-testid="count-loss-cost"
          >
            {{ money(totals.lossCost) }}
          </div>
          <div class="text-sm text-gray-500 dark:text-zinc-400">{{ t('inventory.loss_cost') }}</div>
        </template>
      </Card>
      <Card>
        <template #content>
          <div
            class="text-2xl font-bold text-gray-900 dark:text-zinc-100"
            data-testid="count-loss-value"
          >
            {{ money(totals.lossValue) }}
          </div>
          <div class="text-sm text-gray-500 dark:text-zinc-400">
            {{ t('inventory.loss_value') }} — {{ t('inventory.loss_value_hint') }}
          </div>
        </template>
      </Card>
    </div>

    <h2 class="mb-2 text-lg font-semibold text-gray-800 dark:text-zinc-200">
      {{ t('inventory.differences') }}
    </h2>
    <p v-if="savedReasons.size > 0" class="mb-3 text-sm text-gray-500 dark:text-zinc-400">
      {{ t('inventory.classify_hint') }}
    </p>
    <DataTable :value="changedItems" stripedRows class="mb-6 rounded-lg border" dataKey="productId">
      <Column :header="t('common.product')">
        <template #body="{ data }">{{ data.productName }}</template>
      </Column>
      <Column :header="t('inventory.expected_column')">
        <template #body="{ data }">{{ data.expectedQty }} {{ t('common.pieces') }}</template>
      </Column>
      <Column :header="t('inventory.counted_column')">
        <template #body="{ data }">{{ data.countedQty }} {{ t('common.pieces') }}</template>
      </Column>
      <Column :header="t('inventory.applied_column')">
        <template #body="{ data }">
          <span class="font-semibold" :class="diffClass(data.appliedQty)">{{
            data.appliedQty > 0 ? `+${data.appliedQty}` : data.appliedQty
          }}</span>
        </template>
      </Column>
      <Column :header="t('inventory.reason_column')">
        <template #body="{ data }">
          <Select
            v-if="reasons[data.productId]"
            :modelValue="reasons[data.productId]"
            :options="reasonOptions"
            optionLabel="label"
            optionValue="value"
            class="w-56"
            :disabled="savingProductId !== null"
            :loading="savingProductId === data.productId"
            :aria-label="t('inventory.reason_for', { name: data.productName })"
            :data-testid="`count-reason-${data.productId}`"
            @update:modelValue="(value: LossReason) => changeReason(data.productId, value)"
          />
          <span v-else class="text-gray-500 dark:text-zinc-400">{{
            data.appliedQty > 0 ? t('inventory.reason_surplus') : '—'
          }}</span>
        </template>
      </Column>
      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('inventory.no_differences') }}
        </div>
      </template>
    </DataTable>

    <Button
      :label="lotsVisible ? t('inventory.lots_hide') : t('inventory.lots_show')"
      :icon="lotsVisible ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
      severity="secondary"
      text
      size="small"
      :aria-expanded="lotsVisible"
      data-testid="count-lots-toggle"
      @click="lotsVisible = !lotsVisible"
    />
    <DataTable
      v-if="lotsVisible"
      :value="count.adjustments"
      stripedRows
      class="mt-2 rounded-lg border"
      dataKey="id"
      data-testid="count-lots"
    >
      <Column :header="t('common.product')">
        <template #body="{ data }">{{ productName.get(data.productId) ?? '—' }}</template>
      </Column>
      <Column :header="t('common.supplier')">
        <template #body="{ data }">{{ data.supplierName }}</template>
      </Column>
      <Column :header="t('inventory.change')">
        <template #body="{ data }">
          <span :class="diffClass(data.kind === 'loss' ? -data.quantity : data.quantity)">{{
            data.kind === 'loss' ? `−${data.quantity}` : `+${data.quantity}`
          }}</span>
        </template>
      </Column>
      <Column :header="t('inventory.reason_column')">
        <template #body="{ data }">
          <span :data-testid="`count-lot-reason-${data.id}`">{{ adjustmentReason(data) }}</span>
        </template>
      </Column>
      <Column :header="t('supplier.deliveries_purchase_price')">
        <template #body="{ data }">{{ money(data.unitCost) }}</template>
      </Column>
      <Column :header="t('supplier.deliveries_price')">
        <template #body="{ data }">{{ money(data.unitPrice) }}</template>
      </Column>
      <template #empty>
        <div class="py-8 text-center text-gray-500 dark:text-zinc-400">
          {{ t('inventory.no_differences') }}
        </div>
      </template>
    </DataTable>
  </AppLayout>
</template>
