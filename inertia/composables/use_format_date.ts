/**
 * Shared date formatting utilities that produce consistent output on both
 * Node.js and the browser by always using the Europe/Prague timezone.
 * This keeps output stable across environments.
 */

const CS_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Europe/Prague',
}

const CS_DATETIME_OPTIONS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Prague',
}

function getActiveLocale(): string {
  if (typeof document !== 'undefined') {
    const lang = document.documentElement?.lang
    if (lang) return lang
  }

  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language
  }

  return 'cs-CZ'
}

export function formatDate(iso: string | undefined | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(getActiveLocale(), CS_DATE_OPTIONS)
}

export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(getActiveLocale(), CS_DATETIME_OPTIONS)
}
