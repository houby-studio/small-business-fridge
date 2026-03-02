import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import User from '#models/user'
import UserAuthIdentity, { type ExternalAuthProvider } from '#models/user_auth_identity'

export type IdentityMatch =
  | { kind: 'matched'; user: User; via: 'provider' | 'email_linked' }
  | { kind: 'not_found' }
  | { kind: 'ambiguous_email'; email: string; userIds: number[] }
  | { kind: 'provider_conflict'; userId: number; provider: ExternalAuthProvider }

export default class AuthIdentityService {
  async resolveForLogin(params: {
    provider: ExternalAuthProvider
    providerUserId: string | null
    email: string | null
  }): Promise<IdentityMatch> {
    const providerUserId = params.providerUserId?.trim() || null
    const email = params.email?.trim().toLowerCase() || null

    if (providerUserId) {
      const byProvider = await UserAuthIdentity.query()
        .where('provider', params.provider)
        .where('providerUserId', providerUserId)
        .preload('user')
        .first()
      if (byProvider) {
        return { kind: 'matched', user: byProvider.user, via: 'provider' }
      }
    }

    if (!email) return { kind: 'not_found' }

    const users = await User.query().whereRaw('LOWER(email) = ?', [email]).orderBy('id', 'asc')
    if (users.length === 0) return { kind: 'not_found' }
    if (users.length > 1) {
      return { kind: 'ambiguous_email', email, userIds: users.map((user) => user.id) }
    }

    const user = users[0]
    const existingIdentity = await UserAuthIdentity.query()
      .where('userId', user.id)
      .where('provider', params.provider)
      .first()

    if (existingIdentity && providerUserId && existingIdentity.providerUserId !== providerUserId) {
      return { kind: 'provider_conflict', provider: params.provider, userId: user.id }
    }

    return { kind: 'matched', user, via: 'email_linked' }
  }

  async ensureLinkedIdentity(params: {
    userId: number
    provider: ExternalAuthProvider
    providerUserId: string
    providerEmail: string | null
    providerEmailVerified: boolean
  }): Promise<'linked' | 'already_linked'> {
    const providerUserId = params.providerUserId.trim()
    const providerEmail = params.providerEmail?.trim().toLowerCase() || null
    const providerEmailVerified = params.providerEmailVerified === true

    const conflict = await UserAuthIdentity.query()
      .where('provider', params.provider)
      .where('providerUserId', providerUserId)
      .whereNot('userId', params.userId)
      .first()
    if (conflict) {
      throw new Error('PROVIDER_IDENTITY_ALREADY_LINKED')
    }

    const existingForUser = await UserAuthIdentity.query()
      .where('userId', params.userId)
      .where('provider', params.provider)
      .first()
    if (existingForUser) {
      if (existingForUser.providerUserId !== providerUserId) {
        throw new Error('PROVIDER_ALREADY_LINKED_WITH_DIFFERENT_ID')
      }

      const update: Partial<UserAuthIdentity> = {}
      if (existingForUser.providerEmail !== providerEmail) {
        update.providerEmail = providerEmail
      }
      if (existingForUser.providerEmailVerified !== providerEmailVerified) {
        update.providerEmailVerified = providerEmailVerified
      }
      update.lastLoginAt = DateTime.utc()

      if (Object.keys(update).length > 0) {
        existingForUser.merge(update)
        await existingForUser.save()
      }

      return 'already_linked'
    }

    await UserAuthIdentity.create({
      userId: params.userId,
      provider: params.provider,
      providerUserId,
      providerEmail,
      providerEmailVerified,
      lastLoginAt: DateTime.utc(),
    })

    await db.from('users').where('id', params.userId).update({ updated_at: DateTime.utc().toSQL() })

    return 'linked'
  }

  async hasTrustedLinkedEmail(userId: number, emailInput: string): Promise<boolean> {
    const email = emailInput.trim().toLowerCase()
    const identity = await UserAuthIdentity.query()
      .where('userId', userId)
      .whereRaw('LOWER(provider_email) = ?', [email])
      .where('providerEmailVerified', true)
      .first()
    return !!identity
  }
}
