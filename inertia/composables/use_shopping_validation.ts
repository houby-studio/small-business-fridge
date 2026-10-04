// Mirrors app/validators/shopping.ts and app/validators/inventory.ts — update both sides
// together.
export const PRODUCT_GROUP_NAME_MAX = 100
export const PRODUCT_GROUP_NOTE_MAX = 500
export const SHOPPING_LABEL_MAX = 255
export const SHOPPING_NOTE_MAX = 255
export const STOCK_DRAFT_NOTE_MAX = 500
export const STOCK_DRAFT_MAX_ITEMS = 200
export const ADJUSTMENT_NOTE_MAX = 500
export const WRITE_OFF_REASONS = ['expired', 'damaged', 'stolen', 'other'] as const
export const LOSS_REASONS = ['inventory', 'damaged', 'expired', 'stolen', 'other'] as const
export type LossReason = (typeof LOSS_REASONS)[number]
export const MIN_HORIZON_DAYS = 1
export const MAX_HORIZON_DAYS = 60
export const MAX_MARGIN_PERCENT = 100

/** A trimmed name within the limit — the rule every free-text name field here follows. */
export function nameError(
  value: string,
  max: number,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const trimmed = value.trim()
  if (!trimmed) return t('shopping.validation_name_required')
  if (trimmed.length > max) return t('shopping.validation_name_max', { max })
  return ''
}
