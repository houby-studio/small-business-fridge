/**
 * Shared date formatting utilities that produce consistent output on both
 * SSR (Node.js) and the browser by always using the Europe/Prague timezone.
 * This prevents Vue hydration mismatches caused by server/client timezone differences.
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

export function formatDate(iso: string | undefined | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('cs-CZ', CS_DATE_OPTIONS)
}

export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('cs-CZ', CS_DATETIME_OPTIONS)
}
