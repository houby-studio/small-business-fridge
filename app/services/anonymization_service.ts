import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import User from '#models/user'
import AuditService from '#services/audit_service'

export type AnonymizationSummary = {
  candidates: number
  anonymized: number
  failed: number
}

export default class AnonymizationService {
  static readonly DEFAULT_GRACE_DAYS = 7

  static anonymizedDisplayName(userId: number): string {
    return `Deleted user #${userId}`
  }

  static anonymizedEmail(userId: number): string {
    return `deleted-${userId}@anon`
  }

  /**
   * Anonymize a single user. Idempotent: a user with anonymizedAt set is skipped.
   * Refuses to anonymize an active (non-disabled) account.
   */
  async anonymizeUser(userId: number): Promise<boolean> {
    const result = await db.transaction(async (trx) => {
      const user = await User.query({ client: trx }).where('id', userId).forUpdate().first()
      if (!user) return { anonymized: false, disabledAtIso: null as string | null }
      if (user.anonymizedAt) return { anonymized: false, disabledAtIso: null }
      if (!user.isDisabled) {
        throw new Error('CANNOT_ANONYMIZE_ACTIVE_USER')
      }

      const originalEmailLower = user.email?.toLowerCase() ?? null
      const disabledAtIso = user.disabledAt?.toISO() ?? null

      // Drop everything that can re-establish access or that exposes personal data.
      await trx.from('user_auth_identities').where('user_id', user.id).delete()
      await trx.from('remember_me_tokens').where('tokenable_id', user.id).delete()
      await trx.from('auth_access_tokens').where('tokenable_id', user.id).delete()
      await trx.from('email_verification_tokens').where('user_id', user.id).delete()
      await trx.from('iban_change_tokens').where('user_id', user.id).delete()
      await trx.from('profile_pending_drafts').where('user_id', user.id).delete()
      await trx.from('user_favorites').where('user_id', user.id).delete()
      await trx.from('user_excluded_allergen').where('user_id', user.id).delete()
      await trx.from('recommendations').where('user_id', user.id).delete()

      // password_reset_tokens are keyed by email, not user_id.
      if (originalEmailLower) {
        await trx
          .from('password_reset_tokens')
          .whereRaw('LOWER(email) = ?', [originalEmailLower])
          .delete()
      }

      // Wipe PII. Historic orders/invoices keep pointing at this user_id
      // and will surface as "Deleted user #<id>" in admin views.
      user.displayName = AnonymizationService.anonymizedDisplayName(user.id)
      user.email = AnonymizationService.anonymizedEmail(user.id)
      user.phone = null
      user.iban = null
      user.pendingIban = null
      user.pendingEmail = null
      user.emailVerifiedAt = null
      user.ibanVerifiedAt = null
      user.cardId = null
      user.keypadId = null
      user.password = null
      user.anonymizedAt = DateTime.utc()
      await user.useTransaction(trx).save()

      return { anonymized: true, disabledAtIso }
    })

    if (result.anonymized) {
      // Audit insert holds an FK against users.id; running it after the
      // transaction commits avoids contending with the row lock we held above.
      await AuditService.log(userId, 'user.anonymized', 'user', userId, null, {
        disabledAt: result.disabledAtIso,
      })
    }

    return result.anonymized
  }

  /**
   * Find users disabled for at least `graceDays` days and not yet anonymized,
   * then anonymize each. Continues past per-user failures so one bad row does
   * not stop the nightly batch.
   */
  async anonymizeDisabledUsers(graceDays: number): Promise<AnonymizationSummary> {
    const safeGrace = Number.isFinite(graceDays) && graceDays >= 0 ? graceDays : 0
    const cutoff = DateTime.utc().minus({ days: safeGrace }).toJSDate()

    const candidates = await User.query()
      .where('isDisabled', true)
      .whereNull('anonymizedAt')
      .where((q) => {
        q.where('disabledAt', '<=', cutoff).orWhereNull('disabledAt')
      })
      .select('id')

    let anonymized = 0
    let failed = 0
    for (const candidate of candidates) {
      try {
        const wasAnonymized = await this.anonymizeUser(candidate.id)
        if (wasAnonymized) anonymized++
      } catch (err) {
        failed++
        logger.error({ err, userId: candidate.id }, 'Failed to anonymize user')
      }
    }

    return { candidates: candidates.length, anonymized, failed }
  }
}
