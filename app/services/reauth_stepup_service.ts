import hash from '@adonisjs/core/services/hash'
import { DateTime } from 'luxon'
import type User from '#models/user'
import env from '#start/env'

type SessionLike = {
  get: (key: string) => unknown
  put: (key: string, value: any) => void
}

export default class ReauthStepupService {
  private static readonly SESSION_KEY = '__sensitive_reauth_at'

  ttlMinutes() {
    return Math.max(0, env.get('SENSITIVE_ACTION_REAUTH_TTL_MINUTES') ?? 10)
  }

  private getMarkedAt(session: SessionLike) {
    const raw = session.get(ReauthStepupService.SESSION_KEY)
    if (typeof raw !== 'string' || raw.length === 0) return null
    const at = DateTime.fromISO(raw, { zone: 'utc' })
    return at.isValid ? at : null
  }

  markNow(session: SessionLike) {
    session.put(ReauthStepupService.SESSION_KEY, DateTime.utc().toISO())
  }

  isRecent(session: SessionLike) {
    if (this.ttlMinutes() <= 0) return false
    const at = this.getMarkedAt(session)
    if (!at) return false

    const maxAge = DateTime.utc().minus({ minutes: this.ttlMinutes() })
    return at >= maxAge
  }

  recentValidUntilIso(session: SessionLike) {
    if (!this.isRecent(session)) return null
    const at = this.getMarkedAt(session)
    if (!at) return null
    return at.plus({ minutes: this.ttlMinutes() }).toISO()
  }

  async verifyLocalPasswordStepup(user: Pick<User, 'password'>, currentPassword: string | null) {
    if (!user.password) return false
    if (!currentPassword || currentPassword.trim().length === 0) return false
    return hash.verify(user.password, currentPassword)
  }
}
