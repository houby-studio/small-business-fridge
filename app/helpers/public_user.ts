import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type User from '#models/user'

/**
 * Preload callback that loads only the public part of another user — id and display name.
 *
 * Lucid serializes every non-hidden column of a preloaded relation, and User hides only the
 * password. Any page that `.serialize()`s rows with another user preloaded (a buyer's orders
 * with their supplier, a supplier's invoices with their buyers) would otherwise hand that
 * user's email, IBAN, keypad and card ID to the browser.
 */
export function PUBLIC_USER_COLUMNS(query: ModelQueryBuilderContract<typeof User>) {
  query.select('id', 'display_name')
}
