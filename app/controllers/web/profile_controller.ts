import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import {
  updateProfileValidator,
  toggleColorModeValidator,
  updateExcludedAllergensValidator,
} from '#validators/user'
import { createApiTokenValidator } from '#validators/auth'
import AuditService from '#services/audit_service'
import User from '#models/user'
import Allergen from '#models/allergen'
import Product from '#models/product'
import AuthModeService from '#services/auth_mode_service'
import AuthIdentityService from '#services/auth_identity_service'
import EmailVerificationService from '#services/email_verification_service'
import NotificationService from '#services/notification_service'

export default class ProfileController {
  private authModes = new AuthModeService()
  private authIdentity = new AuthIdentityService()
  private verifications = new EmailVerificationService()

  private async getExcludedAllergenIds(userId: number): Promise<number[]> {
    const rows = await db
      .from('user_excluded_allergen')
      .where('user_id', userId)
      .orderBy('allergen_id', 'asc')
      .select('allergen_id')
    return rows.map((row) => Number(row.allergen_id))
  }

  private async syncExcludedAllergenIds(user: User, excludedAllergenIds: number[]): Promise<void> {
    const sanitized = [...new Set(excludedAllergenIds.map(Number))]
      .filter((id) => Number.isInteger(id) && id > 0)
      .sort((a, b) => a - b)
    await user.related('excludedAllergens').sync(sanitized)
  }

  async show({ inertia, auth }: HttpContext) {
    const user = auth.user!
    await user.load((loader) => loader.load('favoriteProducts').load('authIdentities'))
    const excludedAllergenIds = await this.getExcludedAllergenIds(user.id)

    // List personal API tokens — exclude short-lived kiosk tokens
    const tokens = await db
      .from('auth_access_tokens')
      .where('tokenable_id', user.id)
      .whereNotIn('name', ['kiosk-token', 'api-token'])
      .orderBy('created_at', 'desc')
      .select(['id', 'name', 'created_at', 'last_used_at', 'expires_at'])

    const allergens = await Allergen.query()
      .where('isDisabled', false)
      .orderBy('name', 'asc')
      .select('id', 'name')

    return inertia.render('profile/show', {
      user: { ...user.serialize(), excludedAllergenIds },
      tokens,
      allergens: allergens.map((a) => ({ id: a.id, name: a.name })),
      externalProviders: this.authModes.getEnabledExternalProviders(),
      linkedProviders: user.authIdentities.map((identity) => identity.provider),
    })
  }

  async update({ request, auth, response, session, i18n }: HttpContext) {
    const user = auth.user!
    const data = await request.validateUsing(updateProfileValidator)
    const before = {
      displayName: user.displayName,
      email: user.email,
      pendingEmail: user.pendingEmail,
      emailVerifiedAt: user.emailVerifiedAt?.toISO() ?? null,
      phone: user.phone,
      iban: user.iban,
      showAllProducts: user.showAllProducts,
      sendMailOnPurchase: user.sendMailOnPurchase,
      sendDailyReport: user.sendDailyReport,
      colorMode: user.colorMode,
      keypadDisabled: user.keypadDisabled,
      excludedAllergenIds: await this.getExcludedAllergenIds(user.id),
    }

    const requestedEmail = data.email.trim().toLowerCase()
    const currentEmail = user.email.trim().toLowerCase()
    let emailPendingVerificationPayload: { verificationUrl: string; email: string } | null = null
    let emailUpdateMessageKey: string | null = null

    if (requestedEmail !== currentEmail) {
      const existing = await User.query()
        .whereNot('id', user.id)
        .whereRaw('LOWER(email) = ?', [requestedEmail])
        .first()
      if (existing) {
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.invite_email_already_registered'),
        })
        return response.redirect('/profile')
      }

      const isTrustedLinkedEmail = await this.authIdentity.hasTrustedLinkedEmail(
        user.id,
        requestedEmail
      )
      if (isTrustedLinkedEmail) {
        user.email = requestedEmail
        user.pendingEmail = null
        user.emailVerifiedAt = DateTime.utc()
        emailUpdateMessageKey = 'messages.email_changed_via_linked_identity'
      } else {
        user.pendingEmail = requestedEmail
        const verification = await this.verifications.createToken(user, requestedEmail)
        emailPendingVerificationPayload = {
          verificationUrl: verification.verificationUrl,
          email: verification.token.email,
        }
        emailUpdateMessageKey = 'messages.email_change_pending_verification'
      }
    } else if (user.pendingEmail) {
      user.pendingEmail = null
    }

    user.displayName = data.displayName
    user.phone = data.phone ?? null
    user.iban = data.iban ?? null
    user.showAllProducts = data.showAllProducts
    user.sendMailOnPurchase = data.sendMailOnPurchase
    user.sendDailyReport = data.sendDailyReport
    user.colorMode = data.colorMode
    user.keypadDisabled = data.keypadDisabled
    await user.save()

    if (emailPendingVerificationPayload) {
      const notifications = new NotificationService()
      notifications
        .sendEmailVerificationEmail({
          email: emailPendingVerificationPayload.email,
          displayName: user.displayName,
          verificationUrl: emailPendingVerificationPayload.verificationUrl,
        })
        .catch((err) => {
          logger.error(
            { err, userId: user.id, email: emailPendingVerificationPayload?.email },
            'Failed to send profile email verification'
          )
        })
    }

    if (data.excludedAllergenIds !== undefined) {
      await this.syncExcludedAllergenIds(user, data.excludedAllergenIds)
    }

    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const key of [
      'displayName',
      'email',
      'phone',
      'iban',
      'showAllProducts',
      'sendMailOnPurchase',
      'sendDailyReport',
      'colorMode',
      'keypadDisabled',
    ] as const) {
      if (before[key] !== user[key]) {
        changes[key] = { from: before[key], to: user[key] }
      }
    }
    if (before.pendingEmail !== user.pendingEmail) {
      changes.pendingEmail = { from: before.pendingEmail, to: user.pendingEmail }
    }
    if (before.emailVerifiedAt !== (user.emailVerifiedAt?.toISO() ?? null)) {
      changes.emailVerifiedAt = {
        from: before.emailVerifiedAt,
        to: user.emailVerifiedAt?.toISO() ?? null,
      }
    }

    const afterExcluded = await this.getExcludedAllergenIds(user.id)
    if (
      before.excludedAllergenIds.length !== afterExcluded.length ||
      before.excludedAllergenIds.some((id, index) => id !== afterExcluded[index])
    ) {
      const allergenIds = [...new Set([...before.excludedAllergenIds, ...afterExcluded])]
      const allergenRows =
        allergenIds.length > 0
          ? await Allergen.query().whereIn('id', allergenIds).select('id', 'name')
          : []
      const namesById = new Map(allergenRows.map((a) => [a.id, a.name]))
      const toLabel = (ids: number[]) =>
        ids.map((id) => namesById.get(id) ?? `#${id}`).join(', ') || '—'

      changes.excludedAllergens = {
        from: toLabel(before.excludedAllergenIds),
        to: toLabel(afterExcluded),
      }
    }

    const metadata = Object.keys(changes).length ? changes : null

    await AuditService.log(user.id, 'profile.updated', 'user', user.id, null, metadata)

    session.flash('alert', {
      type:
        emailUpdateMessageKey === 'messages.email_change_pending_verification' ? 'info' : 'success',
      message: i18n.t(emailUpdateMessageKey ?? 'messages.profile_updated'),
    })
    return response.redirect('/profile')
  }

  async toggleColorMode({ request, auth, response }: HttpContext) {
    const user = auth.user!
    const before = user.colorMode
    const data = await request.validateUsing(toggleColorModeValidator)
    user.colorMode = data.colorMode
    await user.save()
    if (before !== user.colorMode) {
      const metadata = {
        colorMode: { from: before, to: user.colorMode },
      }
      await AuditService.log(user.id, 'profile.updated', 'user', user.id, null, metadata)
    }
    return response.redirect().back()
  }

  async createToken({ request, auth, response, session, i18n }: HttpContext) {
    const user = auth.user!
    const data = await request.validateUsing(createApiTokenValidator)

    const expiresIn = data.expiresInDays ? `${data.expiresInDays} days` : undefined

    const token = await User.accessTokens.create(user, ['*'], {
      name: data.name,
      expiresIn,
    })

    await AuditService.log(user.id, 'profile.token.created', 'user', user.id, null, {
      tokenName: data.name,
    })

    // Flash the raw token ONCE — it will never be shown again
    session.flash('newApiToken', {
      name: data.name,
      token: token.value!.release(),
    })
    session.flash('alert', { type: 'success', message: i18n.t('messages.token_created') })

    return response.redirect('/profile')
  }

  async revokeToken({ params, auth, response, session, i18n }: HttpContext) {
    const user = auth.user!
    const tokenId = Number(params.id)

    // Verify the token belongs to this user before deleting
    const owned = await db
      .from('auth_access_tokens')
      .where('id', tokenId)
      .where('tokenable_id', user.id)
      .first()

    if (!owned) {
      session.flash('alert', { type: 'danger', message: i18n.t('messages.not_found') })
      return response.redirect('/profile')
    }

    await User.accessTokens.delete(user, tokenId)

    await AuditService.log(user.id, 'profile.token.revoked', 'user', user.id, null, {
      tokenName: owned.name,
    })

    session.flash('alert', { type: 'success', message: i18n.t('messages.token_revoked') })
    return response.redirect('/profile')
  }

  async updateExcludedAllergens({ request, auth, response }: HttpContext) {
    const user = auth.user!
    const before = await this.getExcludedAllergenIds(user.id)
    const data = await request.validateUsing(updateExcludedAllergensValidator)
    await this.syncExcludedAllergenIds(user, data.excludedAllergenIds)

    const after = await this.getExcludedAllergenIds(user.id)
    if (before.length !== after.length || before.some((id, index) => id !== after[index])) {
      const allergenIds = [...new Set([...before, ...after])]
      const allergenRows =
        allergenIds.length > 0
          ? await Allergen.query().whereIn('id', allergenIds).select('id', 'name')
          : []
      const namesById = new Map(allergenRows.map((a) => [a.id, a.name]))
      const toLabel = (ids: number[]) =>
        ids.map((id) => namesById.get(id) ?? `#${id}`).join(', ') || '—'

      await AuditService.log(user.id, 'profile.updated', 'user', user.id, null, {
        excludedAllergens: { from: toLabel(before), to: toLabel(after) },
      })
    }

    return response.redirect().back()
  }

  async toggleFavorite({ params, auth, response }: HttpContext) {
    const user = auth.user!
    const productId = Number(params.id)
    const product = await Product.find(productId)
    if (!product) {
      return response.redirect('/shop')
    }

    // Check if already favorited
    const existing = await user
      .related('favoriteProducts')
      .query()
      .where('products.id', productId)
      .first()

    if (existing) {
      await user.related('favoriteProducts').detach([productId])
      await AuditService.log(user.id, 'favorite.removed', 'product', productId, null, {
        name: product.displayName,
      })
    } else {
      await user.related('favoriteProducts').attach([productId])
      await AuditService.log(user.id, 'favorite.added', 'product', productId, null, {
        name: product.displayName,
      })
    }

    return response.redirect('/shop')
  }
}
