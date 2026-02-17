import type { HttpContext } from '@adonisjs/core/http'

export default class ProfileController {
  async show({ inertia, auth }: HttpContext) {
    const user = auth.user!
    await user.load((loader) => loader.load('favoriteProducts'))
    return inertia.render('profile/show', { user: user.serialize() })
  }

  async update({ response }: HttpContext) {
    // TODO: Phase 3 — Update user preferences
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
