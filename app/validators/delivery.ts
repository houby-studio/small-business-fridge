import vine from '@vinejs/vine'

/** Shared with the frontend mirror in inertia/composables/use_delivery_correction_validation.ts */
export const CORRECTION_REASON_MIN_LENGTH = 3
export const CORRECTION_REASON_MAX_LENGTH = 500
/** Sanity caps — far above any fridge item, well below the integer column limit. */
export const DELIVERY_MAX_PRICE = 100_000
export const DELIVERY_MAX_AMOUNT = 10_000

export const correctDeliveryValidator = vine.compile(
  vine.object({
    amount: vine.number().withoutDecimals().min(1).max(DELIVERY_MAX_AMOUNT),
    price: vine.number().withoutDecimals().min(1).max(DELIVERY_MAX_PRICE),
    /** What the supplier paid per piece: omitted = unchanged, null = clear, number = new. */
    purchasePrice: vine
      .number()
      .min(0)
      .max(DELIVERY_MAX_PRICE)
      .decimal([0, 2])
      .nullable()
      .optional(),
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

/** Lots one "Změnit cenu" can change at once — far more than a product ever has in stock. */
export const REPRICE_MAX_LOTS = 200

/** "Změnit cenu": a new selling price for chosen lots that still have pieces. */
export const repriceLotsValidator = vine.compile(
  vine.object({
    items: vine
      .array(
        vine.object({
          deliveryId: vine.number().withoutDecimals().min(1).max(2_147_483_647),
          price: vine.number().withoutDecimals().min(1).max(DELIVERY_MAX_PRICE),
        })
      )
      .minLength(1)
      .maxLength(REPRICE_MAX_LOTS)
      .distinct('deliveryId'),
  })
)
