import { useI18n } from '~/composables/use_i18n'

// Mirrors app/services/shopping/pricing.ts — change both together.
export const MAX_MARGIN_PERCENT = 100

/** Selling price from a purchase price and a markup, rounded up to whole currency units. */
export function suggestSellingPrice(purchasePrice: number, marginPercent: number): number {
  const margin = Math.min(MAX_MARGIN_PERCENT, Math.max(0, marginPercent))
  const raw = purchasePrice * (1 + margin / 100)
  const cents = Math.round(raw * 100) / 100
  return Math.max(1, Math.ceil(cents - 1e-9))
}

/**
 * Money with up to two decimals in the user's locale and the instance currency:
 * 14.9 → "14,90 Kč", 15 → "15 Kč".
 */
export function useMoney() {
  const { t, locale } = useI18n()

  function amount(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—'
    const whole = Number.isInteger(value)
    return new Intl.NumberFormat(locale.value === 'cs' ? 'cs-CZ' : 'en-US', {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value)
  }

  function money(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—'
    return t('common.price_with_currency', { price: amount(value) })
  }

  function percent(value: number | null | undefined, digits = 1): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—'
    return `${new Intl.NumberFormat(locale.value === 'cs' ? 'cs-CZ' : 'en-US', {
      maximumFractionDigits: digits,
    }).format(value)} %`
  }

  return { amount, money, percent }
}
