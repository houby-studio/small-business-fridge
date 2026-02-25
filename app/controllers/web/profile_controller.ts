import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
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

    const allergens = await Allergen.query()
      .where('isDisabled', false)
      .orderBy('name', 'asc')
      .select('id', 'name')

    return inertia.render('profile/show', {
      user: user.serialize(),
      tokens,
      allergens: allergens.map((a) => ({ id: a.id, name: a.name })),
    })
  }

  async update({ request, auth, response, session, i18n }: HttpContext) {
    const user = auth.user!
    const data = await request.validateUsing(updateProfileValidator)
    const before = {
      displayName: user.displayName,
      email: user.email,
      phone: user.phone,
      iban: user.iban,
      showAllProducts: user.showAllProducts,
      sendMailOnPurchase: user.sendMailOnPurchase,
      sendDailyReport: user.sendDailyReport,
      colorMode: user.colorMode,
      keypadDisabled: user.keypadDisabled,
      excludedAllergenIds: [...(user.excludedAllergenIds ?? [])].sort((a, b) => a - b),
    }

    user.displayName = data.displayName
    user.email = data.email
    user.phone = data.phone ?? null
    user.iban = data.iban ?? null
    user.showAllProducts = data.showAllProducts
    user.sendMailOnPurchase = data.sendMailOnPurchase
    user.sendDailyReport = data.sendDailyReport
    user.colorMode = data.colorMode
    user.keypadDisabled = data.keypadDisabled
    if (data.excludedAllergenIds !== undefined) {
      user.excludedAllergenIds = data.excludedAllergenIds
    }

    await user.save()

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

    const afterExcluded = [...(user.excludedAllergenIds ?? [])].sort((a, b) => a - b)
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

    AuditService.log(user.id, 'profile.updated', 'user', user.id, null, metadata)
    await db.table('audit_logs').insert({
      user_id: user.id,
      action: 'profile.updated',
      entity_type: 'user',
      entity_id: user.id,
      target_user_id: null,
      metadata,
      created_at: new Date(),
    })

    session.flash('alert', { type: 'success', message: i18n.t('messages.profile_updated') })
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
      AuditService.log(user.id, 'profile.updated', 'user', user.id, null, metadata)
      await db.table('audit_logs').insert({
        user_id: user.id,
        action: 'profile.updated',
        entity_type: 'user',
        entity_id: user.id,
        target_user_id: null,
        metadata,
        created_at: new Date(),
      })
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

  async updateExcludedAllergens({ request, auth, response }: HttpContext) {
    const user = auth.user!
    const before = [...(user.excludedAllergenIds ?? [])].sort((a, b) => a - b)
    const data = await request.validateUsing(updateExcludedAllergensValidator)
    user.excludedAllergenIds = data.excludedAllergenIds
    await user.save()

    const after = [...(user.excludedAllergenIds ?? [])].sort((a, b) => a - b)
    if (before.length !== after.length || before.some((id, index) => id !== after[index])) {
      const allergenIds = [...new Set([...before, ...after])]
      const allergenRows =
        allergenIds.length > 0
          ? await Allergen.query().whereIn('id', allergenIds).select('id', 'name')
          : []
      const namesById = new Map(allergenRows.map((a) => [a.id, a.name]))
      const toLabel = (ids: number[]) =>
        ids.map((id) => namesById.get(id) ?? `#${id}`).join(', ') || '—'

      AuditService.log(user.id, 'profile.updated', 'user', user.id, null, {
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
      AuditService.log(user.id, 'favorite.removed', 'product', productId, null, {
        name: product.displayName,
      })
    } else {
      await user.related('favoriteProducts').attach([productId])
      AuditService.log(user.id, 'favorite.added', 'product', productId, null, {
        name: product.displayName,
      })
    }

    return response.redirect('/shop')
  }
}
