import type { HttpContext } from '@adonisjs/core/http'
import { updateProfileValidator } from '#validators/user'
import AuditService from '#services/audit_service'

export default class ProfileController {
  async show({ inertia, auth }: HttpContext) {
    const user = auth.user!
    await user.load((loader) => loader.load('favoriteProducts'))
    return inertia.render('profile/show', { user: user.serialize() })
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
