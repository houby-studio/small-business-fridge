import type { HttpContext } from '@adonisjs/core/http'

export default class ProfileController {
  async show({ inertia, auth }: HttpContext) {
    // TODO: Phase 3 — Load full user profile
    return inertia.render('profile/show', { user: auth.user })
  }

  async update({ response }: HttpContext) {
    // TODO: Phase 3 — Update user preferences
    return response.redirect('/profile')
  }

  async toggleFavorite({ response }: HttpContext) {
    // TODO: Phase 3 — Toggle product favorite
    return response.redirect('/shop')
  }
}
