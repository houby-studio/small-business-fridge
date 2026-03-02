import env from '#start/env'

const DEFAULT_CURRENCY_CODE = 'CZK'
const ISO_4217_CODE_REGEX = /^[A-Z]{3}$/

function normalizeLocale(locale: string): string {
  const normalized = (locale || '').toLowerCase()
  if (normalized.startsWith('cs')) return 'cs-CZ'
  if (normalized.startsWith('en')) return 'en-US'
  return locale || 'en-US'
}

export function normalizeCurrencyCode(value: string | undefined | null): string {
  const code = (value ?? '').trim().toUpperCase()
  return ISO_4217_CODE_REGEX.test(code) ? code : DEFAULT_CURRENCY_CODE
}

export function resolveCurrencyDisplay(code: string, locale: string): string {
  const safeCode = normalizeCurrencyCode(code)
  const safeLocale = normalizeLocale(locale)

  for (const currencyDisplay of ['narrowSymbol', 'symbol', 'code'] as const) {
    try {
      const parts = new Intl.NumberFormat(safeLocale, {
        style: 'currency',
        currency: safeCode,
        currencyDisplay,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).formatToParts(0)

      const token = parts.find((part) => part.type === 'currency')?.value?.trim()
      if (token) return token
    } catch {
      // Try the next display fallback.
    }
  }

  return safeCode
}

export function getCurrencyCode(): string {
  const configured = process.env.CURRENCY ?? env.get('CURRENCY', DEFAULT_CURRENCY_CODE)
  return normalizeCurrencyCode(configured)
}

export function getCurrencyDisplay(locale: string): string {
  return resolveCurrencyDisplay(getCurrencyCode(), locale)
}
