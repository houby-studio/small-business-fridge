<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import { useI18n } from '~/composables/use_i18n'
import { formatDateTime } from '~/composables/use_format_date'

/**
 * Price of one purchase. When the supplier corrected a mistyped price after the purchase,
 * a compact tag with the original price is shown in the row; the reason (free text of any
 * length) lives in a detail dialog so it never breaks the table layout.
 */
const props = defineProps<{
  unitPrice: number
  originalUnitPrice?: number | null
  correction?: { reason: string; createdAt: string } | null
  bold?: boolean
}>()

const { t } = useI18n()
const detailVisible = ref(false)

const corrected = computed(
  () =>
    props.originalUnitPrice !== null &&
    props.originalUnitPrice !== undefined &&
    props.originalUnitPrice !== props.unitPrice
)
</script>

<template>
  <div class="whitespace-nowrap">
    <span :class="{ 'font-semibold': bold }">{{
      t('common.price_with_currency', { price: unitPrice })
    }}</span>
    <div
      v-if="corrected"
      class="mt-0.5 flex items-center gap-1"
      data-testid="order-price-corrected"
    >
      <span
        class="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-200"
        >{{ t('orders.price_corrected') }}</span
      >
      <span class="text-xs text-gray-500 dark:text-zinc-400">{{
        t('orders.price_original', { price: originalUnitPrice! })
      }}</span>
      <Button
        icon="pi pi-info-circle"
        severity="secondary"
        text
        size="small"
        :aria-label="t('orders.price_correction_detail')"
        data-testid="order-price-correction-detail"
        @click="detailVisible = true"
      />
    </div>

    <Dialog
      v-if="corrected"
      v-model:visible="detailVisible"
      :header="t('orders.price_correction_title')"
      :style="{ width: '28rem', maxWidth: 'calc(100vw - 2rem)' }"
      modal
      :draggable="false"
      data-testid="order-price-correction-dialog"
    >
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm whitespace-normal">
        <dt class="text-gray-500 dark:text-zinc-400">
          {{ t('orders.price_correction_original') }}
        </dt>
        <dd class="text-gray-900 dark:text-zinc-100">
          {{ t('common.price_with_currency', { price: originalUnitPrice! }) }}
        </dd>
        <dt class="text-gray-500 dark:text-zinc-400">{{ t('orders.price_correction_current') }}</dt>
        <dd class="font-semibold text-gray-900 dark:text-zinc-100">
          {{ t('common.price_with_currency', { price: unitPrice }) }}
        </dd>
        <template v-if="correction">
          <dt class="text-gray-500 dark:text-zinc-400">{{ t('orders.price_correction_date') }}</dt>
          <dd class="text-gray-900 dark:text-zinc-100">
            {{ formatDateTime(correction.createdAt) }}
          </dd>
          <dt class="text-gray-500 dark:text-zinc-400">
            {{ t('orders.price_correction_reason') }}
          </dt>
          <dd class="break-words whitespace-pre-line text-gray-900 dark:text-zinc-100">
            {{ correction.reason }}
          </dd>
        </template>
      </dl>
      <template #footer>
        <Button
          :label="t('common.close')"
          severity="secondary"
          text
          autofocus
          @click="detailVisible = false"
        />
      </template>
    </Dialog>
  </div>
</template>
