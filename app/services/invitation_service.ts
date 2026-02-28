import { createHash, randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import User from '#models/user'
import UserInvitation from '#models/user_invitation'

type InviteTokenStatus =
  | { valid: true; invitation: UserInvitation }
  | { valid: false; reason: 'not_found' | 'revoked' | 'expired' | 'accepted' }

export default class InvitationService {
  private signedTokenPrefix = 'sbfv2'

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase()
  }

  private tokenHash(token: string) {
    return createHash('sha256').update(token).digest('hex')
  }

  private appUrl() {
    return env.get('APP_URL') || `http://${env.get('HOST')}:${env.get('PORT')}`
  }

  private signPayload(payload: string) {
    const key = env.get('APP_KEY')
    return createHash('sha256').update(`${key}:${payload}`).digest('hex')
  }

  private signedToken(invitation: UserInvitation) {
    const payload = `${invitation.id}:${invitation.tokenHash}`
    const signature = this.signPayload(payload)
    return `${this.signedTokenPrefix}.${invitation.id}.${signature}`
  }

  private resolveSignedToken(token: string): { inviteId: number; signature: string } | null {
    const [prefix, idRaw, signature] = token.split('.')
    if (prefix !== this.signedTokenPrefix || !idRaw || !signature) return null
    const inviteId = Number(idRaw)
    if (!Number.isInteger(inviteId) || inviteId <= 0) return null
    return { inviteId, signature }
  }

  getInviteUrl(invitation: UserInvitation) {
    return `${this.appUrl()}/register/invite/${this.signedToken(invitation)}`
  }

  async createInvite(params: {
    email: string
    role: 'customer' | 'supplier' | 'admin'
    invitedByUserId: number | null
    expiresInHours?: number
  }) {
    const email = this.normalizeEmail(params.email)
    const expiresInHours = Math.max(
      1,
      params.expiresInHours ?? env.get('INVITE_EXPIRY_HOURS') ?? 168
    )

    const existingUser = await User.query().whereRaw('LOWER(email) = ?', [email]).first()
    if (existingUser) {
      throw new Error('EMAIL_ALREADY_REGISTERED')
    }

    await UserInvitation.query()
      .whereRaw('LOWER(email) = ?', [email])
      .whereNull('acceptedAt')
      .whereNull('revokedAt')
      .where('expiresAt', '>', DateTime.now().toSQL()!)
      .update({ revokedAt: DateTime.now() })

    const rawToken = randomBytes(32).toString('hex')
    const invitation = await UserInvitation.create({
      email,
      role: params.role,
      tokenHash: this.tokenHash(rawToken),
      invitedByUserId: params.invitedByUserId,
      expiresAt: DateTime.now().plus({ hours: expiresInHours }),
    })

    return {
      invitation,
      inviteUrl: this.getInviteUrl(invitation),
    }
  }

  async validateToken(token: string): Promise<InviteTokenStatus> {
    const signed = this.resolveSignedToken(token)
    const invitation = signed
      ? await UserInvitation.find(signed.inviteId)
      : await UserInvitation.findBy('tokenHash', this.tokenHash(token))
    if (!invitation) return { valid: false, reason: 'not_found' }
    if (signed) {
      const expected = this.signPayload(`${invitation.id}:${invitation.tokenHash}`)
      if (expected !== signed.signature) return { valid: false, reason: 'not_found' }
    }
    if (invitation.revokedAt) return { valid: false, reason: 'revoked' }
    if (invitation.acceptedAt) return { valid: false, reason: 'accepted' }
    if (invitation.expiresAt <= DateTime.now()) return { valid: false, reason: 'expired' }

    return { valid: true, invitation }
  }

  async findActiveByEmail(emailInput: string) {
    const email = this.normalizeEmail(emailInput)
    return UserInvitation.query()
      .whereRaw('LOWER(email) = ?', [email])
      .whereNull('acceptedAt')
      .whereNull('revokedAt')
      .where('expiresAt', '>', DateTime.now().toSQL()!)
      .orderBy('createdAt', 'asc')
      .first()
  }

  async revokeInvite(inviteId: number) {
    const invite = await UserInvitation.findOrFail(inviteId)
    if (!invite.revokedAt && !invite.acceptedAt) {
      invite.revokedAt = DateTime.now()
      await invite.save()
    }
    return invite
  }

  async acceptInvite(params: { token: string; displayName: string; password: string }) {
    return db.transaction(async (trx) => {
      const signed = this.resolveSignedToken(params.token)
      const invite = signed
        ? await UserInvitation.query({ client: trx })
            .where('id', signed.inviteId)
            .forUpdate()
            .first()
        : await UserInvitation.query({ client: trx })
            .where('tokenHash', this.tokenHash(params.token))
            .forUpdate()
            .first()

      if (!invite) throw new Error('INVITE_NOT_FOUND')
      if (signed) {
        const expected = this.signPayload(`${invite.id}:${invite.tokenHash}`)
        if (expected !== signed.signature) {
          throw new Error('INVITE_NOT_FOUND')
        }
      }
      if (invite.revokedAt) throw new Error('INVITE_REVOKED')
      if (invite.acceptedAt) throw new Error('INVITE_ALREADY_ACCEPTED')
      if (invite.expiresAt <= DateTime.now()) throw new Error('INVITE_EXPIRED')

      const existingEmail = await User.query({ client: trx })
        .whereRaw('LOWER(email) = ?', [invite.email.toLowerCase()])
        .first()
      if (existingEmail) throw new Error('EMAIL_ALREADY_REGISTERED')

      const maxKeypad = await User.query({ client: trx }).max('keypad_id as max').first()
      const nextKeypadId = (maxKeypad?.$extras.max ?? 0) + 1

      const user = new User()
      user.useTransaction(trx)
      user.displayName = params.displayName.trim()
      user.email = invite.email
      user.password = params.password
      user.keypadId = nextKeypadId
      user.role = invite.role
      await user.save()

      invite.useTransaction(trx)
      invite.acceptedAt = DateTime.now()
      invite.acceptedUserId = user.id
      await invite.save()

      return user
    })
  }

  async acceptInviteForUser(inviteId: number, userId: number) {
    const invite = await UserInvitation.find(inviteId)
    if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt <= DateTime.now()) {
      return false
    }

    invite.acceptedAt = DateTime.now()
    invite.acceptedUserId = userId
    await invite.save()
    return true
  }
}
