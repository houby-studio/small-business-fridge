import vine from '@vinejs/vine'
import { DELIVERY_MAX_AMOUNT } from '#validators/delivery'
import { MAX_MARGIN_PERCENT } from '#services/shopping/pricing'

/** Shared with the frontend mirror in inertia/composables/use_shopping_validation.ts */
export const ADJUSTMENT_NOTE_MAX = 500
export const INVENTORY_MAX_ITEMS = 2000
/** Most pieces of one product an inventory can count. */
export const INVENTORY_MAX_COUNT = DELIVERY_MAX_AMOUNT * 10
/** Reasons a write-off can give — the pieces are known, so "not specified" is not one of them. */
export const WRITE_OFF_REASONS = ['expired', 'damaged', 'stolen', 'other'] as const
/** Reasons an inventory shortfall can be classified as; `inventory` = no reason given yet. */
export const LOSS_REASONS = ['inventory', 'damaged', 'expired', 'stolen', 'other'] as const
/** What an inventory sheet lists: the actor's own lots, or the whole fridge. */
export const INVENTORY_SCOPES = ['mine', 'all'] as const

export const writeOffValidator = vine.compile(
  vine.object({
    productId: vine.number().positive(),
    quantity: vine.number().withoutDecimals().min(1).max(DELIVERY_MAX_AMOUNT),
    reason: vine.enum(WRITE_OFF_REASONS),
    note: vine.string().trim().maxLength(ADJUSTMENT_NOTE_MAX).optional(),
    /** The lots the dialog showed (FIFO preview) — the server decides; it only says if it differs. */
    preview: vine
      .array(
        vine.object({
          deliveryId: vine.number().withoutDecimals().min(1).max(2_147_483_647),
          quantity: vine.number().withoutDecimals().min(1).max(DELIVERY_MAX_AMOUNT),
        })
      )
      .maxLength(200)
      .optional(),
  })
)

export const inventoryCountValidator = vine.compile(
  vine.object({
    scope: vine.enum(INVENTORY_SCOPES),
    note: vine.string().trim().maxLength(ADJUSTMENT_NOTE_MAX).optional(),
    items: vine
      .array(
        vine.object({
          productId: vine.number().positive(),
          expected: vine.number().withoutDecimals().min(0).max(INVENTORY_MAX_COUNT),
          counted: vine.number().withoutDecimals().min(0).max(INVENTORY_MAX_COUNT),
          /** When the sheet read `expected` (its `stockAsOf`), and when the product was counted. */
          asOf: vine.date({ formats: ['iso8601'] }).optional(),
          countedAt: vine.date({ formats: ['iso8601'] }).optional(),
        })
      )
      .minLength(1)
      .maxLength(INVENTORY_MAX_ITEMS),
  })
)

export const reclassifyLossValidator = vine.compile(
  vine.object({
    reason: vine.enum(LOSS_REASONS),
  })
)

export const supplierSettingsValidator = vine.compile(
  vine.object({
    marginPercent: vine.number().min(0).max(MAX_MARGIN_PERCENT).decimal([0, 2]),
  })
)
