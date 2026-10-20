import vine from '@vinejs/vine'
import { DELIVERY_MAX_AMOUNT, DELIVERY_MAX_PRICE } from '#validators/delivery'
import { MAX_HORIZON_DAYS, MIN_HORIZON_DAYS } from '#services/shopping/demand_math'

/** Shared with the frontend mirror in inertia/composables/use_shopping_validation.ts */
export const PRODUCT_GROUP_NAME_MAX = 100
export const PRODUCT_GROUP_NOTE_MAX = 500
export const SHOPPING_LABEL_MAX = 255
export const SHOPPING_NOTE_MAX = 255
export const STOCK_DRAFT_NOTE_MAX = 500
export const STOCK_DRAFT_MAX_ITEMS = 200

export const productGroupValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(PRODUCT_GROUP_NAME_MAX),
    categoryId: vine.number().positive(),
    note: vine.string().trim().maxLength(PRODUCT_GROUP_NOTE_MAX).nullable().optional(),
    productIds: vine.array(vine.number().positive()).optional(),
  })
)

export const shoppingListSettingsValidator = vine.compile(
  vine.object({
    /** Null = back to the supplier's usual trip interval. */
    horizonDays: vine
      .number()
      .withoutDecimals()
      .min(MIN_HORIZON_DAYS)
      .max(MAX_HORIZON_DAYS)
      .nullable()
      .optional(),
    scope: vine.enum(['mine', 'all'] as const).optional(),
    categoryIds: vine.array(vine.number().positive()).optional(),
  })
)

export const shoppingLineValidator = vine.compile(
  vine.object({
    /** Null = back to the suggested quantity. */
    quantity: vine.number().withoutDecimals().min(0).max(DELIVERY_MAX_AMOUNT).nullable().optional(),
    unitCost: vine.number().min(0).max(DELIVERY_MAX_PRICE).decimal([0, 2]).nullable().optional(),
    isChecked: vine.boolean().optional(),
    isRemoved: vine.boolean().optional(),
    note: vine.string().trim().maxLength(SHOPPING_NOTE_MAX).nullable().optional(),
  })
)

export const shoppingLineCreateValidator = vine.compile(
  vine.object({
    productId: vine.number().positive().optional(),
    label: vine
      .string()
      .trim()
      .minLength(1)
      .maxLength(SHOPPING_LABEL_MAX)
      .optional()
      .requiredIfMissing('productId'),
    quantity: vine.number().withoutDecimals().min(1).max(DELIVERY_MAX_AMOUNT),
    unitCost: vine.number().min(0).max(DELIVERY_MAX_PRICE).decimal([0, 2]).optional(),
    note: vine.string().trim().maxLength(SHOPPING_NOTE_MAX).optional(),
  })
)

const stockDraftItem = vine.object({
  productId: vine.number().positive().nullable().optional(),
  productGroupId: vine.number().positive().nullable().optional(),
  label: vine.string().trim().maxLength(SHOPPING_LABEL_MAX).nullable().optional(),
  amount: vine.number().withoutDecimals().min(1).max(DELIVERY_MAX_AMOUNT),
  purchasePrice: vine.number().min(0).max(DELIVERY_MAX_PRICE).decimal([0, 2]).nullable().optional(),
  /** Still the shopping list's estimate — the page clears it once the price is typed. */
  purchasePriceEstimated: vine.boolean().optional(),
  /** Who put the line on the draft; a saved line sends back what it had. */
  source: vine.enum(['web', 'shopping_list', 'assistant'] as const).optional(),
  price: vine.number().withoutDecimals().min(1).max(DELIVERY_MAX_PRICE).nullable().optional(),
})

export const stockDraftValidator = vine.compile(
  vine.object({
    note: vine.string().trim().maxLength(STOCK_DRAFT_NOTE_MAX).nullable().optional(),
    items: vine.array(stockDraftItem).maxLength(STOCK_DRAFT_MAX_ITEMS),
    /** Set once the supplier has seen the duplicate / unusual price warnings of a commit. */
    confirmWarnings: vine.boolean().optional(),
    /** The draft version the page loaded; a save over a newer one is refused (DRAFT_STALE). */
    version: vine.number().withoutDecimals().min(0).optional(),
  })
)

/** "Stock this" from a product row: opens the supplier's draft with that product appended. */
export const stockDraftStoreValidator = vine.compile(
  vine.object({
    productId: vine.number().positive().optional(),
  })
)
