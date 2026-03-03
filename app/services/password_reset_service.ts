import { createHash, randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import User from '#models/user'
import PasswordResetToken from '#models/password_reset_token'

export default class PasswordResetService {
  private normalizeEmail(email: string) {
    return email.trim().toLowerCase()
  }

  private tokenHash(token: string) {
    return createHash('sha256').update(token).digest('hex')
  }

  private appUrl() {
    return env.get('APP_URL') || `http://${env.get('HOST')}:${env.get('PORT')}`
  }

  async createToken(emailInput: string) {
    const email = this.normalizeEmail(emailInput)
    const user = await User.query().whereRaw('LOWER(email) = ?', [email]).first()

    if (!user || user.isDisabled) {
      return null
    }

    await PasswordResetToken.query()
      .whereRaw('LOWER(email) = ?', [email])
      .whereNull('usedAt')
      .where('expiresAt', '>', DateTime.utc().toSQL()!)
      .delete()

    const rawToken = randomBytes(32).toString('hex')
    const ttlMinutes = env.get('PASSWORD_RESET_TTL_MINUTES', 60)

    await PasswordResetToken.create({
      email,
      tokenHash: this.tokenHash(rawToken),
      expiresAt: DateTime.utc().plus({ minutes: ttlMinutes }),
    })

    return {
      email,
      resetUrl: `${this.appUrl()}/reset-password/${rawToken}`,
    }
  }

  async validateToken(rawToken: string) {
    const token = await PasswordResetToken.findBy('tokenHash', this.tokenHash(rawToken))
    if (!token) return { valid: false as const, reason: 'not_found' as const }
    if (token.usedAt) return { valid: false as const, reason: 'used' as const }
    if (token.expiresAt <= DateTime.utc())
      return { valid: false as const, reason: 'expired' as const }

    return { valid: true as const, token }
  }

  async resetPassword(rawToken: string, newPassword: string) {
    return db.transaction(async (trx) => {
      const token = await PasswordResetToken.query({ client: trx })
        .where('tokenHash', this.tokenHash(rawToken))
        .forUpdate()
        .first()

      if (!token) throw new Error('RESET_TOKEN_NOT_FOUND')
      if (token.usedAt) throw new Error('RESET_TOKEN_USED')
      if (token.expiresAt <= DateTime.utc()) throw new Error('RESET_TOKEN_EXPIRED')

      const user = await User.query({ client: trx })
        .whereRaw('LOWER(email) = ?', [token.email.toLowerCase()])
        .first()
      if (!user) throw new Error('USER_NOT_FOUND')
      if (user.isDisabled) throw new Error('USER_DISABLED')

      user.password = newPassword
      await user.save()

      token.usedAt = DateTime.utc()
      await token.save()

      return user
    })
  }
}
