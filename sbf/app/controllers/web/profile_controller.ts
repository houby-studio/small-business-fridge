import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { updateProfileValidator, toggleColorModeValidator } from '#validators/user'
import { createApiTokenValidator } from '#validators/auth'
import AuditService from '#services/audit_service'
import User from '#models/user'

export default class ProfileController {
  async show({ inertia, auth }: HttpContext) {
    const user = auth.user!
    await user.load((loader) => loader.load('favoriteProducts'))

    // List personal API tokens — exclude short-lived kiosk tokens
    const tokens = await db
      .from('auth_access_tokens')
      .where('tokenable_id', user.id)
      .whereNotIn('name', ['kiosk-token', 'api-token'])
      .orderBy('created_at', 'desc')
      .select(['id', 'name', 'created_at', 'last_used_at', 'expires_at'])

    return inertia.render('profile/show', { user: user.serialize(), tokens })
  }

  async update({ request, auth, response, session, i18n }: HttpContext) {
    const user = auth.user!
    const data = await request.validateUsing(updateProfileValidator)

    user.displayName = data.displayName
    user.email = data.email
    user.phone = data.phone ?? null
    user.iban = data.iban ?? null
    user.showAllProducts = data.showAllProducts
    user.sendMailOnPurchase = data.sendMailOnPurchase
    user.sendDailyReport = data.sendDailyReport
    user.colorMode = data.colorMode
    user.keypadDisabled = data.keypadDisabled

    await user.save()

    AuditService.log(user.id, 'profile.updated', 'user', user.id)

    session.flash('alert', { type: 'success', message: i18n.t('messages.profile_updated') })
    return response.redirect('/profile')
  }

  async toggleColorMode({ request, auth, response }: HttpContext) {
    const user = auth.user!
    const data = await request.validateUsing(toggleColorModeValidator)
    user.colorMode = data.colorMode
    await user.save()
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

    AuditService.log(user.id, 'profile.token.created', 'user', user.id, null, {
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

    AuditService.log(user.id, 'profile.token.revoked', 'user', user.id, null, {
      tokenName: owned.name,
    })

    session.flash('alert', { type: 'success', message: i18n.t('messages.token_revoked') })
    return response.redirect('/profile')
  }

  async toggleFavorite({ params, auth, response }: HttpContext) {
    const user = auth.user!
    const productId = Number(params.id)

    // Check if already favorited
    const existing = await user
      .related('favoriteProducts')
      .query()
      .where('products.id', productId)
      .first()

    if (existing) {
      await user.related('favoriteProducts').detach([productId])
    } else {
      await user.related('favoriteProducts').attach([productId])
    }

    return response.redirect('/shop')
  }
}
