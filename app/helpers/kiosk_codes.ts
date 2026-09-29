import env from '#start/env'

/** Kiosk input that shows the easter egg instead of looking a customer up. */
export const KIOSK_EASTER_EGG_CODE = '666'

/** Kiosk input that logs the kiosk out (configurable, default 000000). */
export function kioskLogoutCode(): string {
  return env.get('KIOSK_LOGOUT_CODE', '000000')
}

/**
 * Keypad IDs no user may hold. The kiosk answers these codes before it looks a customer
 * up, so a user holding one could never be identified there. The logout code only counts
 * when it is a plain positive number — "000000" can never equal a user's keypad ID.
 */
export function reservedUserKeypadIds(): number[] {
  const ids = [Number(KIOSK_EASTER_EGG_CODE)]
  const logout = kioskLogoutCode().trim()
  if (/^[1-9]\d{0,8}$/.test(logout)) ids.push(Number(logout))
  return ids
}

export function isReservedUserKeypadId(keypadId: number): boolean {
  return reservedUserKeypadIds().includes(keypadId)
}
