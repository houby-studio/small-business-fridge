// Mirrors app/services/shopping/pricing.ts — change both together. No Vue, no i18n here:
// tests/unit/services/shopping/pricing.spec.ts imports this file to compare the two.
export const MAX_MARGIN_PERCENT = 100

/** Selling price from a purchase price and a markup, rounded up to whole currency units. */
export function suggestSellingPrice(purchasePrice: number, marginPercent: number): number {
  const margin = Math.min(MAX_MARGIN_PERCENT, Math.max(0, marginPercent))
  const raw = purchasePrice * (1 + margin / 100)
  const cents = Math.round(raw * 100) / 100
  return Math.max(1, Math.ceil(cents - 1e-9))
}

/** Purchase price plus margin, never below the product's last selling price. */
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
