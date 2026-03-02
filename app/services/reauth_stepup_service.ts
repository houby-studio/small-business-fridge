import hash from '@adonisjs/core/services/hash'
import { DateTime } from 'luxon'
import type User from '#models/user'
import env from '#start/env'

type SessionLike = {
  get: (key: string) => unknown
  put: (key: string, value: any) => void
  pull?: (key: string, defaultValue?: unknown) => unknown
}

export default class ReauthStepupService {
  private static readonly SESSION_KEY = '__sensitive_reauth_at'
  private static readonly ONE_TIME_GRANT_KEY = '__sensitive_stepup_grant'

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

  markOneTimeGrant(session: SessionLike, userId: number) {
    session.put(ReauthStepupService.ONE_TIME_GRANT_KEY, {
      userId,
      issuedAt: DateTime.utc().toISO(),
    })
  }

  consumeOneTimeGrant(session: SessionLike, userId: number, maxAgeMinutes = 5) {
    if (typeof session.pull !== 'function') return false
    const raw = session.pull(ReauthStepupService.ONE_TIME_GRANT_KEY, null)
    if (!raw || typeof raw !== 'object') return false

    const grant = raw as { userId?: unknown; issuedAt?: unknown }
    if (grant.userId !== userId) return false
    if (typeof grant.issuedAt !== 'string' || grant.issuedAt.length === 0) return false

    const issuedAt = DateTime.fromISO(grant.issuedAt, { zone: 'utc' })
    if (!issuedAt.isValid) return false

    return DateTime.utc().diff(issuedAt, 'minutes').minutes <= maxAgeMinutes
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
