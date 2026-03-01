import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import User from '#models/user'
import { loginValidator } from '#validators/auth'
import AuditService from '#services/audit_service'
import RegistrationPolicyService from '#services/registration_policy_service'
import AuthModeService from '#services/auth_mode_service'

export default class LoginController {
  private registrationPolicy = new RegistrationPolicyService()
  private authModes = new AuthModeService()
  private async hasAnyAdmin(): Promise<boolean> {
    const admin = await User.query().where('role', 'admin').first()
    return !!admin
  }

  async show({ inertia, response }: HttpContext) {
    if (!(await this.hasAnyAdmin())) {
      return response.redirect('/setup/bootstrap')
    }

    const externalProviders = this.authModes.getEnabledExternalProviders()
    if (this.authModes.isLocalLoginDisabled() && externalProviders.length === 1) {
      return response.redirect(`/auth/${externalProviders[0]}/redirect`)
    }
    const mode = this.registrationPolicy.getMode()
    return inertia.render('auth/login', {
      externalProviders,
      allowLocalRegistration: mode === 'open' || mode === 'domain_auto_approve',
      localEnabled: this.authModes.isLocalEnabled(),
    })
  }

  async store({ request, auth, response, session, i18n }: HttpContext) {
    if (!(await this.hasAnyAdmin())) {
      return response.redirect('/setup/bootstrap')
    }

    if (this.authModes.isLocalLoginDisabled()) {
      const externalProviders = this.authModes.getEnabledExternalProviders()
      return response.redirect(
        externalProviders.length === 1 ? `/auth/${externalProviders[0]}/redirect` : '/login'
      )
    }

    const { email, password, rememberMe } = await request.validateUsing(loginValidator)

    try {
      const user = await User.verifyCredentials(email, password)

      if (user.isDisabled) {
        logger.warn({ userId: user.id, email }, 'Login denied: account disabled')
        session.flash('alert', { type: 'danger', message: i18n.t('messages.account_disabled') })
        return response.redirect('/login')
      }

      await auth.use('web').login(user, !!rememberMe)
      logger.info({ userId: user.id, email }, 'Password login success')
      await AuditService.log(user.id, 'user.login', 'user', user.id, null, {
        via: 'password',
        ip: request.ip(),
        ua: request.header('user-agent') ?? null,
      })
      return response.redirect('/shop')
    } catch {
      logger.warn({ email }, 'Password login failed: invalid credentials')
      session.flash('alert', { type: 'danger', message: i18n.t('messages.login_failed') })
      return response.redirect('/login')
    }
  }

  async destroy({ auth, request, response }: HttpContext) {
    const userId = auth.user?.id ?? null
    await auth.use('web').logout()
    if (userId) {
      await AuditService.log(userId, 'user.logout', 'user', userId, null, {
        ip: request.ip(),
        ua: request.header('user-agent') ?? null,
      })
    }
    return response.redirect('/')
  }
}
