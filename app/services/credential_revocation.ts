import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/**
 * Revoke the credentials of a user that outlive a session.
 *
 * Sessions expire on their own, but remember-me tokens (2 years) and personal API tokens
 * (optional expiry) do not — so whenever an account is disabled or its password changes,
 * they have to go, or the old credential keeps granting access.
 *
 * `includeApiTokens` separates the two situations: after a password *reset* or an account
 * being disabled every credential is suspect, while a user deliberately changing their own
 * password should keep the API tokens they created on purpose and can see in their profile.
 *
 * Pass `trx` when the caller already has a transaction open, so the revocation commits or
 * rolls back together with the change that triggered it.
 */
export async function revokeLongLivedCredentials(
  userId: number,
  options: { trx?: TransactionClientContract; includeApiTokens?: boolean } = {}
) {
  const client = options.trx ?? db

  await client.from('remember_me_tokens').where('tokenable_id', userId).delete()

  if (options.includeApiTokens !== false) {
    await client.from('auth_access_tokens').where('tokenable_id', userId).delete()
  }
}
