import { useI18n } from '~/composables/use_i18n'

export {
  MAX_MARGIN_PERCENT,
  suggestDraftPrice,
  suggestSellingPrice,
} from '~/composables/pricing_rules'

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
