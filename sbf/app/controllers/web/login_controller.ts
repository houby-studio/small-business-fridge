import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { loginValidator } from '#validators/auth'
import env from '#start/env'

export default class LoginController {
  async show({ inertia }: HttpContext) {
    return inertia.render('auth/login', {
      oidcEnabled: env.get('OIDC_ENABLED', false),
    })
  }

  async store({ request, auth, response, session, i18n }: HttpContext) {
    const { username, password } = await request.validateUsing(loginValidator)

    try {
      const user = await User.verifyCredentials(username, password)

      if (user.isDisabled) {
        session.flash('alert', { type: 'danger', message: i18n.t('messages.account_disabled') })
        return response.redirect('/login')
      }

      await auth.use('web').login(user)
      return response.redirect('/shop')
    } catch {
      session.flash('alert', { type: 'danger', message: i18n.t('messages.login_failed') })
      return response.redirect('/login')
    }
  }

  async destroy({ auth, response }: HttpContext) {
    await auth.use('web').logout()
    return response.redirect('/login')
  }
}
