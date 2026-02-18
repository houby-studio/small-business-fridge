import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
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
        logger.warn({ userId: user.id, username }, 'Login denied: account disabled')
        session.flash('alert', { type: 'danger', message: i18n.t('messages.account_disabled') })
        return response.redirect('/login')
      }

      await auth.use('web').login(user)
      logger.info({ userId: user.id, username }, 'Password login success')
      return response.redirect('/shop')
    } catch {
      logger.warn({ username }, 'Password login failed: invalid credentials')
      session.flash('alert', { type: 'danger', message: i18n.t('messages.login_failed') })
      return response.redirect('/login')
    }
  }

  async destroy({ auth, response }: HttpContext) {
    await auth.use('web').logout()
    return response.redirect('/login')
  }
}
