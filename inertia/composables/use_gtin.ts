/**
 * Client mirror of `app/services/product_images/gtin.ts` — decides whether the form offers
 * contributing to Open Food Facts. The server decides again; keep both in step.
 */
const RESTRICTED_GTIN13 = [
  '02',
  '04',
  '05',
  ...Array.from({ length: 10 }, (_, i) => `2${i}`),
  '977',
  '978',
  '979',
  '980',
  '981',
  '982',
  '983',
  '984',
  '99',
]

function hasValidCheckDigit(code: string): boolean {
  const digits = code.split('').map(Number)
  const check = digits.pop()!
  const sum = digits
    .reverse()
    .reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

export function isPublicGtin(raw: string): boolean {
  const code = raw.trim()
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false
  if (!hasValidCheckDigit(code)) return false
  if (code.length === 8) return !/^[02]/.test(code)
  if (code.length === 14 && code[0] !== '0') return false
  const gtin13 = code.length === 12 ? `0${code}` : code.length === 14 ? code.slice(1) : code
  return !RESTRICTED_GTIN13.some((prefix) => gtin13.startsWith(prefix))
}
