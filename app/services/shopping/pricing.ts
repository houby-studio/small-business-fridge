/**
 * Price arithmetic shared by stocking, the shopping list and the finance overview.
 * Mirrored for live form hints in inertia/composables/pricing_rules.ts — change both; the
 * parity test in tests/unit/services/shopping/pricing.spec.ts compares them.
 */

export const MAX_MARGIN_PERCENT = 100

/**
 * Selling price from a purchase price and the supplier's markup, rounded up to whole
 * currency units (customers pay whole crowns): 14.90 at 0 % → 15, at 5 % → 16.
 */
export function suggestSellingPrice(purchasePrice: number, marginPercent: number): number {
  const margin = Math.min(MAX_MARGIN_PERCENT, Math.max(0, marginPercent))
  const raw = purchasePrice * (1 + margin / 100)
  // Strip float noise first: 14.9 * 1 must stay 15, not become 16.
  const cents = Math.round(raw * 100) / 100
  return Math.max(1, Math.ceil(cents - 1e-9))
}

/**
 * The selling price a stocking line gets when the supplier types none — one rule for the
 * web form, the draft commit, its warnings and the MCP tools: the purchase price plus the
 * owner's margin, but never below what the product sold for last time (an established
 * price is not lowered by accident). Null when there is neither to go on.
 */
export function suggestDraftPrice(
  purchasePrice: number | null | undefined,
  marginPercent: number,
  lastPrice: number | null | undefined
): number | null {
  const fromMargin =
    purchasePrice === null || purchasePrice === undefined
      ? null
      : suggestSellingPrice(purchasePrice, marginPercent)
  const last = lastPrice === null || lastPrice === undefined || lastPrice <= 0 ? null : lastPrice
  if (fromMargin !== null && last !== null) return Math.max(fromMargin, last)
  return fromMargin ?? last
}

/**
 * Markup that only breaks even when `lossRate` (0–1) of the pieces are never paid for:
 * with 5 % shrinkage the paid 95 % must also cover the missing 5 %.
 */
export function breakEvenMarginPercent(lossRate: number): number {
  if (!Number.isFinite(lossRate) || lossRate <= 0) return 0
  if (lossRate >= 0.5) return MAX_MARGIN_PERCENT
  return Math.round((lossRate / (1 - lossRate)) * 10_000) / 100
}

/** Round money to cents for storage and display. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}
