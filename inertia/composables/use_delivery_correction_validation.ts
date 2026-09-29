import { computed, type Ref } from 'vue'
import { useI18n } from '~/composables/use_i18n'

// Mirrors app/validators/delivery.ts (and the amount rules in DeliveryService.correctDelivery:
// only decreases, never below the sold count).
// Update both sides together.
export const CORRECTION_REASON_MIN_LENGTH = 3
export const CORRECTION_REASON_MAX_LENGTH = 500

export interface DeliveryCorrectionFormState {
  amount: number | null
  price: number | null
  reason: string
}

/**
 * Client-side validation for the delivery correction dialog. `current` is the delivery as
 * stocked today: the amount may not drop below what was sold, and something must change.
 */
export function useDeliveryCorrectionValidation(
  form: Ref<DeliveryCorrectionFormState>,
  current: Ref<{ amountSupplied: number; price: number; soldCount: number } | null>
) {
  const { t } = useI18n()

  const minAmount = computed(() => Math.max(1, current.value?.soldCount ?? 0))

  const amountError = computed(() => {
    const v = form.value.amount
    if (v !== null && current.value && v > current.value.amountSupplied) {
      return t('supplier.correction_amount_max_hint', { max: current.value.amountSupplied })
    }
    if (v === null || !Number.isInteger(v) || v < minAmount.value) {
      return (current.value?.soldCount ?? 0) > 0
        ? t('supplier.correction_amount_min_hint', { min: minAmount.value })
        : t('supplier.correction_amount_min_one')
    }
    return null
  })

  const priceError = computed(() => {
    const v = form.value.price
    if (v === null || !Number.isInteger(v) || v < 1) return t('supplier.correction_price_hint')
    return null
  })

  // An empty reason only blocks the submit; the dialog shows a neutral hint instead of an
  // error, so a freshly opened dialog does not look broken.
  const reasonEmpty = computed(() => form.value.reason.trim().length === 0)

  const reasonError = computed(() => {
    const length = form.value.reason.trim().length
    if (length === 0) return null
    if (length < CORRECTION_REASON_MIN_LENGTH || length > CORRECTION_REASON_MAX_LENGTH) {
      return t('supplier.correction_reason_hint', {
        min: CORRECTION_REASON_MIN_LENGTH,
        max: CORRECTION_REASON_MAX_LENGTH,
      })
    }
    return null
  })

  const noChange = computed(
    () =>
      current.value !== null &&
      form.value.amount === current.value.amountSupplied &&
      form.value.price === current.value.price
  )

  const isValid = computed(
    () =>
      !amountError.value &&
      !priceError.value &&
      !reasonEmpty.value &&
      !reasonError.value &&
      !noChange.value
  )

  return { minAmount, amountError, priceError, reasonEmpty, reasonError, noChange, isValid }
}
