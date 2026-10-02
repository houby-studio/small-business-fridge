/**
 * Whether a barcode is a real, globally unique product code — the only kind Open Food
 * Facts wants. In-store codes (variable-weight goods, a shop's own labels), coupons,
 * refund receipts and ISSN/ISBN numbers are valid barcodes but name nothing outside the
 * shop or the publication, so they must never be contributed.
 *
 * Mirrored for the form in `inertia/composables/use_gtin.ts` — keep both in step.
 */
export function isPublicGtin(raw: string): boolean {
  const code = raw.trim()
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false
  if (!hasValidCheckDigit(code)) return false

  if (code.length === 8) {
    // GTIN-8 prefixes 0 and 2 are reserved for restricted circulation.
    return !/^[02]/.test(code)
  }

  // GTIN-12 (UPC-A) is GTIN-13 with a leading zero; GTIN-14 only with indicator digit 0
  // is the same trade item, any other indicator is a case or a pallet.
  const gtin13 = code.length === 12 ? `0${code}` : code.length === 14 ? code.slice(1) : code
  if (code.length === 14 && code[0] !== '0') return false

  return !RESTRICTED_GTIN13.some((prefix) => gtin13.startsWith(prefix))
}

/**
 * GS1 prefixes that do not identify a trade item: restricted circulation (02, 04, 20–29;
 * UPC 2/4/5 land on 02/04/05), coupons (05, 981–984, 99), ISSN/ISBN (977–979) and refund
 * receipts (980).
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

/** GS1 mod-10: weights 3 and 1 alternate from the digit next to the check digit. */
function hasValidCheckDigit(code: string): boolean {
  const digits = code.split('').map(Number)
  const check = digits.pop()!
  const sum = digits
    .reverse()
    .reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}
