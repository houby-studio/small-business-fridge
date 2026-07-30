import { randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'

export type PendingDraftAction =
  | { type: 'profile-submit' }
  | { type: 'password-change' }
  | { type: 'oidc-link'; provider: 'microsoft' | 'discord' }

export type PendingDraftPayload = {
  action: PendingDraftAction
  form: {
    displayName: string
    email: string
    phone: string
    iban: string
    showAllProducts: boolean
    sendMailOnPurchase: boolean
    sendDailyReport: boolean
    colorMode: 'light' | 'dark'
    keypadDisabled: boolean
    excludedAllergenIds: number[]
  }
  password: {
    newPassword: string
    newPasswordConfirmation: string
  }
}

export default class ProfilePendingDraftService {
  private ttlMinutes() {
    const raw = env.get('PROFILE_PENDING_DRAFT_TTL_MINUTES')
    const ttl = raw === undefined || raw === null ? 30 : Number(raw)
    return Number.isFinite(ttl) && ttl > 0 ? Math.max(1, ttl) : 30
  }

  private newDraftKey() {
    return randomBytes(24).toString('hex')
  }

  private nowUtcSql() {
    return DateTime.utc().toSQL()!
  }

  async saveForUser(userId: number, payload: PendingDraftPayload): Promise<string> {
    const now = DateTime.utc()
    const draftKey = this.newDraftKey()

    await db.from('profile_pending_drafts').where('expires_at', '<=', this.nowUtcSql()).delete()

    await db.from('profile_pending_drafts').where('user_id', userId).delete()

    await db.table('profile_pending_drafts').insert({
      user_id: userId,
      draft_key: draftKey,
      payload,
      expires_at: now.plus({ minutes: this.ttlMinutes() }).toSQL(),
      created_at: now.toSQL(),
      updated_at: now.toSQL(),
    })

    return draftKey
  }

  async consumeForUser(userId: number, draftKey: string): Promise<PendingDraftPayload | null> {
    const nowSql = this.nowUtcSql()

    await db.from('profile_pending_drafts').where('expires_at', '<=', nowSql).delete()

    const row = await db
      .from('profile_pending_drafts')
      .where('user_id', userId)
      .where('draft_key', draftKey)
      .where('expires_at', '>', nowSql)
      .first()

    if (!row) {
      return null
    }

    await db.from('profile_pending_drafts').where('id', row.id).delete()

    return row.payload as PendingDraftPayload
  }
}
