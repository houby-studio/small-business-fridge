import { createHash, randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import User from '#models/user'
import EmailVerificationToken from '#models/email_verification_token'
import env from '#start/env'

export type EmailVerificationConsumeResult =
  | { ok: true; user: User; action: 'verified_current' | 'applied_pending' }
  | { ok: false; reason: 'invalid' | 'expired' | 'email_taken' }

export default class EmailVerificationService {
  private tokenHash(token: string) {
    return createHash('sha256').update(token).digest('hex')
  }

  private appUrl() {
    return env.get('APP_URL') || `http://${env.get('HOST')}:${env.get('PORT')}`
  }

  private ttlMinutes() {
    return Math.max(5, env.get('EMAIL_VERIFICATION_TTL_MINUTES') ?? 24 * 60)
  }

  isVerificationRequired() {
    return env.get('AUTH_EMAIL_VERIFICATION_REQUIRED') ?? false
  }

  isUserVerified(user: Pick<User, 'emailVerifiedAt'>) {
    return !!user.emailVerifiedAt
  }

  shouldBlockAppAccess(user: Pick<User, 'emailVerifiedAt'>) {
    return this.isVerificationRequired() && !this.isUserVerified(user)
  }

  async createToken(user: User, emailInput: string) {
    const email = emailInput.trim().toLowerCase()
    const rawToken = randomBytes(32).toString('hex')
    const now = DateTime.utc()

    await EmailVerificationToken.query()
      .where('userId', user.id)
      .whereRaw('LOWER(email) = ?', [email])
      .whereNull('usedAt')
      .update({ usedAt: now })

    const token = await EmailVerificationToken.create({
      userId: user.id,
      email,
      tokenHash: this.tokenHash(rawToken),
      expiresAt: now.plus({ minutes: this.ttlMinutes() }),
      usedAt: null,
    })

    return {
      token,
      verificationUrl: `${this.appUrl()}/email/verify/${rawToken}`,
    }
  }

  async consumeToken(rawToken: string): Promise<EmailVerificationConsumeResult> {
    const tokenHash = this.tokenHash(rawToken)
    const token = await EmailVerificationToken.query()
      .where('tokenHash', tokenHash)
      .whereNull('usedAt')
      .preload('user')
      .first()

    if (!token) {
      return { ok: false, reason: 'invalid' }
    }

    if (token.expiresAt <= DateTime.utc()) {
      token.usedAt = DateTime.utc()
      await token.save()
      return { ok: false, reason: 'expired' }
    }

    const user = token.user
    const tokenEmail = token.email.trim().toLowerCase()
    const currentEmail = user.email.trim().toLowerCase()
    const pendingEmail = user.pendingEmail?.trim().toLowerCase() ?? null

    if (pendingEmail && tokenEmail === pendingEmail) {
      const conflict = await User.query()
        .whereNot('id', user.id)
        .whereRaw('LOWER(email) = ?', [tokenEmail])
        .first()

      if (conflict) {
        token.usedAt = DateTime.utc()
        await token.save()
        return { ok: false, reason: 'email_taken' }
      }

      user.email = tokenEmail
      user.pendingEmail = null
      user.emailVerifiedAt = DateTime.utc()
      await user.save()

      token.usedAt = DateTime.utc()
      await token.save()
      return { ok: true, user, action: 'applied_pending' }
    }

    if (tokenEmail === currentEmail) {
      user.emailVerifiedAt = DateTime.utc()
      await user.save()

      token.usedAt = DateTime.utc()
      await token.save()
      return { ok: true, user, action: 'verified_current' }
    }

    token.usedAt = DateTime.utc()
    await token.save()
    return { ok: false, reason: 'invalid' }
  }

  async inspectTokenOwner(rawToken: string): Promise<number | null> {
    const tokenHash = this.tokenHash(rawToken)
    const token = await EmailVerificationToken.query().where('tokenHash', tokenHash).first()
    if (!token) return null
    if (token.usedAt) return null
    if (token.expiresAt <= DateTime.utc()) return null
    return token.userId
  }

  async createForCurrentOrPendingEmail(user: User) {
    const targetEmail = (user.pendingEmail ?? user.email ?? '').trim().toLowerCase()
    if (!targetEmail) return null

    if (!user.pendingEmail && user.emailVerifiedAt) {
      return null
    }

    return this.createToken(user, targetEmail)
  }
}
