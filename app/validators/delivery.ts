import vine from '@vinejs/vine'

/** Shared with the frontend mirror in inertia/composables/use_delivery_correction_validation.ts */
export const CORRECTION_REASON_MIN_LENGTH = 3
export const CORRECTION_REASON_MAX_LENGTH = 500

export const createDeliveryValidator = vine.compile(
  vine.object({
    productId: vine.number().positive(),
    amount: vine.number().positive().min(1),
    price: vine.number().positive().min(1),
    // Set once the supplier has seen and confirmed the duplicate / unusual price warning.
    confirmWarnings: vine.boolean().optional(),
  })
)

export const correctDeliveryValidator = vine.compile(
  vine.object({
    amount: vine.number().withoutDecimals().min(1),
    price: vine.number().withoutDecimals().min(1),
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
