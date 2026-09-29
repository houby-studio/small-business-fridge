<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { router, usePage } from '@inertiajs/vue3'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import Textarea from 'primevue/textarea'
import { useI18n } from '~/composables/use_i18n'
import {
  useDeliveryCorrectionValidation,
  CORRECTION_REASON_MAX_LENGTH,
  DELIVERY_MAX_PRICE,
  type DeliveryCorrectionFormState,
} from '~/composables/use_delivery_correction_validation'

export interface CorrectableDelivery {
  id: number
  productName: string
  amountSupplied: number
  amountLeft: number
  price: number
  soldCount: number
  invoicedCount: number
  uninvoicedCount: number
  uninvoicedBuyerCount: number
}

const props = defineProps<{
  delivery: CorrectableDelivery | null
  mode: 'edit' | 'void'
}>()

const visible = defineModel<boolean>('visible', { required: true })

const { t, tp } = useI18n()
const page = usePage()

// Field errors from a server-side validation failure (Inertia shares them as `errors`).
function serverError(field: 'amount' | 'price' | 'reason'): string | null {
  const value = (page.props.errors as Record<string, string | string[]> | undefined)?.[field]
  return (Array.isArray(value) ? value[0] : value) ?? null
}
const amountMessage = computed(() => amountError.value ?? serverError('amount'))
const priceMessage = computed(() => priceError.value ?? serverError('price'))
const reasonMessage = computed(() => reasonError.value ?? serverError('reason'))

// Why "Save" is disabled, shown as text rather than a tooltip (touch, screen readers).
const submitHint = computed(() => {
  if (isVoid.value) return null
  if (noChange.value) return t('supplier.correction_no_change_hint')
  if (reasonEmpty.value) return t('supplier.correction_reason_required')
  return null
})

const form = ref<DeliveryCorrectionFormState>({ amount: null, price: null, reason: '' })
const submitting = ref(false)
const current = computed(() => props.delivery)

const { amountError, priceError, reasonEmpty, reasonError, noChange, isValid } =
  useDeliveryCorrectionValidation(form, current)

watch(
  () => [visible.value, props.delivery?.id],
  () => {
    if (!visible.value || !props.delivery) return
    form.value = {
      amount: props.delivery.amountSupplied,
      price: props.delivery.price,
      reason: '',
    }
  },
  { immediate: true }
)

const isVoid = computed(() => props.mode === 'void')

// The character counter only matters once the reason gets close to the limit.
const REASON_COUNTER_FROM = 400

const dialogStyle = computed(() =>
  isVoid.value
    ? { width: '28rem', maxWidth: 'calc(100vw - 2rem)' }
    : { width: '560px', maxWidth: 'calc(100vw - 2rem)' }
)

const header = computed(() =>
  isVoid.value
    ? t('supplier.void_title')
    : t('supplier.correction_title_with_product', { product: props.delivery?.productName ?? '' })
)

// Nothing left to sell: the amount can no longer be lowered below the sold count.
const allSold = computed(() => props.delivery !== null && props.delivery.amountLeft === 0)

const amountHelp = computed(() => {
  const d = props.delivery
  if (!d) return ''
  if (allSold.value) return t('supplier.correction_amount_all_sold')
  return d.soldCount > 0
    ? t('supplier.correction_amount_help_min', { min: d.soldCount })
    : t('supplier.correction_amount_help')
})

const priceChanged = computed(
  () =>
    props.delivery !== null &&
    form.value.price !== null &&
    form.value.price !== props.delivery.price
)

const priceDiffTotal = computed(() => {
  if (!props.delivery || form.value.price === null) return 0
  return (form.value.price - props.delivery.price) * props.delivery.uninvoicedCount
})

// One or two plain sentences instead of a list. The warning colour is reserved for the case
// that reaches buyers (their uninvoiced purchases change and they get an email).
const impact = computed(() => {
  const d = props.delivery
  if (!d || !priceChanged.value) return null

  const invoiced =
    d.invoicedCount > 0
      ? tp('supplier.correction_impact_invoiced', d.invoicedCount, { price: d.price })
      : ''

  if (d.uninvoicedCount > 0) {
    const repriced = t(
      priceDiffTotal.value > 0
        ? 'supplier.correction_impact_more'
        : 'supplier.correction_impact_less',
      { count: d.uninvoicedCount, diff: Math.abs(priceDiffTotal.value) }
    )
    const email = tp('supplier.correction_impact_email', d.uninvoicedBuyerCount)
    return { reachesBuyers: true, text: [repriced, email, invoiced].filter(Boolean).join(' ') }
  }

  const stock =
    d.amountLeft > 0 ? t('supplier.correction_impact_stock_only', { count: d.amountLeft }) : ''
  return { reachesBuyers: false, text: [stock, invoiced].filter(Boolean).join(' ') }
})

const voidValid = computed(
  () =>
    props.delivery !== null &&
    props.delivery.soldCount === 0 &&
    !reasonEmpty.value &&
    !reasonError.value
)

function close() {
  visible.value = false
}

/**
 * A refused correction (e.g. someone bought from the delivery meanwhile) comes back as a
 * plain redirect with a danger flash, which Inertia reports as success. Keep the dialog —
 * and the typed reason — open; the parent refreshes the delivery's numbers.
 */
function closeUnlessRefused(props: Record<string, unknown>) {
  const alert = (props.flash as { alert?: { type?: string } } | undefined)?.alert
  if (alert?.type === 'danger') return
  close()
}

function submit() {
  if (!props.delivery) return

  if (isVoid.value) {
    if (!voidValid.value) return
    submitting.value = true
    router.delete(`/supplier/deliveries/${props.delivery.id}`, {
      data: { reason: form.value.reason.trim() },
      preserveScroll: true,
      onSuccess: (response) => closeUnlessRefused(response.props),
      onFinish: () => {
        submitting.value = false
      },
    })
    return
  }

  if (!isValid.value) return
  submitting.value = true
  router.put(
    `/supplier/deliveries/${props.delivery.id}`,
    {
      amount: form.value.amount,
      price: form.value.price,
      reason: form.value.reason.trim(),
    },
    {
      preserveScroll: true,
      onSuccess: (response) => closeUnlessRefused(response.props),
      onFinish: () => {
        submitting.value = false
      },
    }
  )
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    :header="header"
    :style="dialogStyle"
    modal
    :draggable="false"
    data-testid="delivery-correction-dialog"
  >
    <div v-if="delivery" class="space-y-4">
      <p v-if="isVoid" class="text-sm text-gray-700 dark:text-zinc-300">
        {{
          t('supplier.void_description', {
            amount: delivery.amountSupplied,
            product: delivery.productName,
            price: delivery.price,
          })
        }}
      </p>

      <template v-else>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
              >{{ t('supplier.correction_amount') }} *</label
            >
            <InputNumber
              v-model="form.amount"
              fluid
              highlightOnFocus
              :min="1"
              :max="delivery.amountSupplied"
              :disabled="allSold"
              :suffix="' ' + t('common.pieces')"
              :invalid="!!amountMessage"
              data-testid="correction-amount"
            />
            <small
              v-if="amountMessage"
              class="mt-1 block text-xs leading-snug text-red-500 dark:text-red-400"
              >{{ amountMessage }}</small
            >
            <small
              v-else
              class="mt-1 block text-xs leading-snug text-gray-500 dark:text-zinc-400"
              data-testid="correction-amount-help"
              >{{ amountHelp }}</small
            >
          </div>
          <div>
            <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
              >{{ t('supplier.correction_price') }} *</label
            >
            <InputNumber
              v-model="form.price"
              :pt="{ pcInputText: { root: { autofocus: true } } }"
              fluid
              highlightOnFocus
              :min="1"
              :max="DELIVERY_MAX_PRICE"
              :suffix="' ' + t('common.currency')"
              :invalid="!!priceMessage"
              data-testid="correction-price"
            />
            <small
              v-if="priceMessage"
              class="mt-1 block text-xs leading-snug text-red-500 dark:text-red-400"
              >{{ priceMessage }}</small
            >
          </div>
        </div>

        <p
          v-if="impact && impact.text"
          :class="
            impact.reachesBuyers
              ? 'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-200'
              : 'text-sm text-gray-500 dark:text-zinc-400'
          "
          data-testid="correction-impact"
        >
          {{ impact.text }}
        </p>
      </template>

      <div>
        <label class="mb-1 block text-sm text-gray-700 dark:text-zinc-300"
          >{{ isVoid ? t('supplier.void_reason') : t('supplier.correction_reason') }} *</label
        >
        <Textarea
          v-model="form.reason"
          :autofocus="isVoid"
          rows="2"
          class="w-full"
          :maxlength="CORRECTION_REASON_MAX_LENGTH"
          :placeholder="
            isVoid
              ? t('supplier.void_reason_placeholder')
              : t('supplier.correction_reason_placeholder')
          "
          :invalid="!!reasonMessage"
          data-testid="correction-reason"
        />
        <div class="flex justify-between gap-2">
          <small v-if="reasonMessage" class="text-red-500 dark:text-red-400">{{
            reasonMessage
          }}</small>
          <small v-else-if="isVoid" class="text-gray-500 dark:text-zinc-400">{{
            t('supplier.void_reason_help')
          }}</small>
          <small
            v-else-if="submitHint"
            class="text-gray-500 dark:text-zinc-400"
            data-testid="correction-submit-hint"
            >{{ submitHint }}</small
          >
          <span v-else />
          <small
            v-if="form.reason.length > REASON_COUNTER_FROM"
            class="shrink-0 text-gray-400 dark:text-zinc-500"
            >{{ form.reason.length }}/{{ CORRECTION_REASON_MAX_LENGTH }}</small
          >
        </div>
      </div>
    </div>

    <template #footer>
      <Button :label="t('common.cancel')" severity="secondary" text @click="close" />
      <Button
        v-if="isVoid"
        :label="t('supplier.void_submit')"
        severity="danger"
        :disabled="!voidValid || submitting"
        :loading="submitting"
        data-testid="correction-submit"
        @click="submit"
      />
      <Button
        v-else
        :label="t('supplier.correction_submit')"
        :disabled="!isValid || submitting"
        :loading="submitting"
        data-testid="correction-submit"
        @click="submit"
      />
    </template>
  </Dialog>
</template>
