import type { HttpContext } from '@adonisjs/core/http'

export default class HomeController {
  async index({ auth, response, inertia }: HttpContext) {
    // If user is logged in, redirect to shop
    if (auth.isAuthenticated) {
      return response.redirect('/shop')
    }
    return inertia.render('home')
  }
}
