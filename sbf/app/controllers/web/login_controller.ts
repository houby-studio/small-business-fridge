import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'

export default class LoginController {
  async show({ inertia }: HttpContext) {
    return inertia.render('auth/login')
  }

  async store({ request, auth, response, session }: HttpContext) {
    const { username, password } = request.only(['username', 'password'])
    const user = await User.verifyCredentials(username, password)
    await auth.use('web').login(user)
    session.flash('alert', { type: 'success', message: 'Login successful.' })
    return response.redirect('/shop')
  }

  async destroy({ auth, response }: HttpContext) {
    await auth.use('web').logout()
    return response.redirect('/login')
  }
}
