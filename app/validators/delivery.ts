import vine from '@vinejs/vine'

/** Shared with the frontend mirror in inertia/composables/use_delivery_correction_validation.ts */
export const CORRECTION_REASON_MIN_LENGTH = 3
export const CORRECTION_REASON_MAX_LENGTH = 500
/** Sanity caps — far above any fridge item, well below the integer column limit. */
export const DELIVERY_MAX_PRICE = 100_000
export const DELIVERY_MAX_AMOUNT = 10_000

export const createDeliveryValidator = vine.compile(
  vine.object({
    productId: vine.number().positive(),
    amount: vine.number().withoutDecimals().min(1).max(DELIVERY_MAX_AMOUNT),
    price: vine.number().withoutDecimals().min(1).max(DELIVERY_MAX_PRICE),
    // Set once the supplier has seen and confirmed the duplicate / unusual price warning.
    confirmWarnings: vine.boolean().optional(),
  })
)

export const correctDeliveryValidator = vine.compile(
  vine.object({
    amount: vine.number().withoutDecimals().min(1).max(DELIVERY_MAX_AMOUNT),
    price: vine.number().withoutDecimals().min(1).max(DELIVERY_MAX_PRICE),
    reason: vine
      .string()
      .trim()
      .minLength(CORRECTION_REASON_MIN_LENGTH)
      .maxLength(CORRECTION_REASON_MAX_LENGTH),
  })
)

export const voidDeliveryValidator = vine.compile(
  vine.object({
    reason: vine
      .string()
      .trim()
      .minLength(CORRECTION_REASON_MIN_LENGTH)
      .maxLength(CORRECTION_REASON_MAX_LENGTH),
  })
)
