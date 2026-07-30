/**
 * Named request DTOs for the REST API. Referenced from controller `@requestBody <...>`
 * annotations so Scalar shows a clean, accurate request schema.
 *
 * VineJS remains the authoritative runtime validation — keep these in sync with the
 * validators in app/validators/ (see AGENTS.md validation architecture).
 */

export interface OrderCreateRequest {
  /** Delivery lot to purchase from (see product listing `deliveryId`). */
  deliveryId: number
  /** Purchase channel. */
  channel: 'kiosk' | 'scanner'
}

export interface TokenLoginRequest {
  email: string
  password: string
}

export interface KioskLoginRequest {
  /** Numeric keypad ID of the user (either this or cardId is required). */
  keypadId?: number
  /** Card identifier of the user (either this or keypadId is required). */
  cardId?: string
  /** Shared kiosk API secret (API_SECRET env). */
  apiSecret: string
}
