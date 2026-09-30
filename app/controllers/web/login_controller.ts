import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import User from '#models/user'
import { loginValidator } from '#validators/auth'
import AuditService from '#services/audit_service'
import RegistrationPolicyService from '#services/registration_policy_service'
import AuthModeService from '#services/auth_mode_service'
import EmailVerificationService from '#services/email_verification_service'
import { normalizeInternalReturnTo } from '#helpers/safe_return_path'

export default class LoginController {
  private registrationPolicy = new RegistrationPolicyService()
  private authModes = new AuthModeService()
  private verifications = new EmailVerificationService()
  private async hasAnyAdmin(): Promise<boolean> {
    const admin = await User.query().where('role', 'admin').first()
    return !!admin
  }

  async show({ inertia, request, response, session }: HttpContext) {
    if (!(await this.hasAnyAdmin())) {
      return response.redirect('/setup/bootstrap')
    }

    const returnTo = normalizeInternalReturnTo(request.input('returnTo'), '/shop')

    const externalProviders = this.authModes.getEnabledExternalProviders()
    if (
      this.authModes.isLocalLoginDisabled() &&
      externalProviders.length === 1 &&
      !session.flashMessages.has('alert')
    ) {
      const redirectUrl = `/auth/${externalProviders[0]}/redirect${returnTo !== '/shop' ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`
      return response.redirect(redirectUrl)
    }
    const mode = this.registrationPolicy.getMode()
    return inertia.render('auth/login', {
      externalProviders,
      allowLocalRegistration: mode === 'open' || mode === 'domain_auto_approve',
      localEnabled: this.authModes.isLocalEnabled(),
      returnTo: returnTo !== '/shop' ? returnTo : null,
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

      // A fresh login never resumes an impersonation left in this browser's session.

      session.forget('__impersonation')

      await auth.use('web').login(user, !!rememberMe)
      logger.info({ userId: user.id, email }, 'Password login success')
      await AuditService.log(user.id, 'user.login', 'user', user.id, null, {
        via: 'password',
        ip: request.ip(),
        ua: request.header('user-agent') ?? null,
      })
      if (this.verifications.shouldBlockAppAccess(user)) {
        session.flash('alert', {
          type: 'warn',
          message: i18n.t('messages.email_verification_required'),
        })
        return response.redirect('/profile')
      }
      const returnTo = normalizeInternalReturnTo(request.input('returnTo'), '/shop')
      return response.redirect(returnTo)
    } catch {
      logger.warn({ email }, 'Password login failed: invalid credentials')
      session.flash('alert', { type: 'danger', message: i18n.t('messages.login_failed') })
      return response.redirect('/login')
    }
  }

  async destroy(ctx: HttpContext) {
    const { auth, request, response, session } = ctx
    let userId = auth.user?.id ?? null

    // Logging out while impersonating ends the impersonation and logs out the *admin* — the
    // impersonated user stays signed in wherever they are. Record it that way, and put the
    // admin back as the guard's user so logout() deletes the admin's remember-me token.
    const impersonator = ctx.impersonator
    if (impersonator) {
      const targetId = userId
      await AuditService.log(
        impersonator.id,
        'admin.impersonate.stop',
        'user',
        targetId,
        targetId,
        { reason: 'logout' }
      )
      session.forget('__impersonation')
      const admin = await User.find(impersonator.id)
      if (admin) {
        ;(auth.use('web') as unknown as { user: User }).user = admin
      }
      userId = impersonator.id
    }

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
