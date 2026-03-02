import { createHash, randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import env from '#start/env'
import type User from '#models/user'
import IbanChangeToken from '#models/iban_change_token'

export type IbanConsumeResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'invalid' | 'expired' }

export default class IbanChangeService {
  private tokenHash(token: string) {
    return createHash('sha256').update(token).digest('hex')
  }

  private appUrl() {
    return env.get('APP_URL') || `http://${env.get('HOST')}:${env.get('PORT')}`
  }

  private ttlMinutes() {
    return Math.max(5, env.get('IBAN_CHANGE_TTL_MINUTES') ?? 24 * 60)
  }

  async createToken(user: User, ibanInput: string) {
    const iban = ibanInput.trim().toUpperCase()
    const rawToken = randomBytes(32).toString('hex')
    const now = DateTime.utc()

    await IbanChangeToken.query()
      .where('userId', user.id)
      .whereNull('usedAt')
      .update({ usedAt: now })

    const token = await IbanChangeToken.create({
      userId: user.id,
      iban,
      tokenHash: this.tokenHash(rawToken),
      expiresAt: now.plus({ minutes: this.ttlMinutes() }),
      usedAt: null,
    })

    return {
      token,
      verificationUrl: `${this.appUrl()}/profile/iban/verify/${rawToken}`,
    }
  }

  async createForPendingIban(user: User) {
    const pending = user.pendingIban?.trim().toUpperCase()
    if (!pending) return null
    return this.createToken(user, pending)
  }

  async consumeToken(rawToken: string): Promise<IbanConsumeResult> {
    const tokenHash = this.tokenHash(rawToken)
    const token = await IbanChangeToken.query()
      .where('tokenHash', tokenHash)
      .whereNull('usedAt')
      .preload('user')
      .first()

    if (!token) return { ok: false, reason: 'invalid' }

    if (token.expiresAt <= DateTime.utc()) {
      token.usedAt = DateTime.utc()
      await token.save()
      return { ok: false, reason: 'expired' }
    }

    const user = token.user
    const pending = user.pendingIban?.trim().toUpperCase() ?? null
    if (!pending || pending !== token.iban) {
      token.usedAt = DateTime.utc()
      await token.save()
      return { ok: false, reason: 'invalid' }
    }

    user.iban = pending
    user.pendingIban = null
    user.ibanVerifiedAt = DateTime.utc()
    await user.save()

    token.usedAt = DateTime.utc()
    await token.save()

    return { ok: true, user }
  }
}
