import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import User from '#models/user'
import AuditService from '#services/audit_service'
import NotificationService from '#services/notification_service'
import RegistrationPolicyService from '#services/registration_policy_service'
import AuthModeService from '#services/auth_mode_service'
import { registerValidator } from '#validators/auth'

export default class RegisterController {
  private registrationPolicy = new RegistrationPolicyService()
  private authModes = new AuthModeService()

  async show({ inertia, response }: HttpContext) {
    if (this.authModes.isOidcOnlyMode()) {
      return response.redirect('/login')
    }

    const hasAnyAdmin = !!(await User.query().where('role', 'admin').first())
    if (!hasAnyAdmin) {
      return response.redirect('/setup/bootstrap')
    }

    return inertia.render('auth/register', {})
  }

  async store({ request, auth, response, session, i18n }: HttpContext) {
    if (this.authModes.isOidcOnlyMode()) {
      return response.redirect('/login')
    }

    const hasAnyAdmin = !!(await User.query().where('role', 'admin').first())
    if (!hasAnyAdmin) {
      return response.redirect('/setup/bootstrap')
    }

    const data = await request.validateUsing(registerValidator)
    if (data.password !== data.passwordConfirmation) {
      session.flash('alert', {
        type: 'danger',
        message: i18n.t('auth.bootstrap_password_mismatch'),
      })
      return response.redirect('/register')
    }

    const normalizedEmail = data.email.trim().toLowerCase()
    const policy = this.registrationPolicy.canSelfRegister({
      provider: 'local',
      email: normalizedEmail,
    })
    if (!policy.allowed) {
      session.flash('alert', {
        type: 'danger',
        message: i18n.t('messages.registration_not_allowed'),
      })
      return response.redirect('/login')
    }

    const existingEmail = await User.query().whereRaw('LOWER(email) = ?', [normalizedEmail]).first()
    if (existingEmail) {
      session.flash('alert', {
        type: 'danger',
        message: i18n.t('messages.invite_email_already_registered'),
      })
      return response.redirect('/register')
    }

    const maxKeypad = await User.query().max('keypad_id as max').first()
    const nextKeypadId = (maxKeypad?.$extras.max ?? 0) + 1

    const user = await User.create({
      displayName: data.displayName.trim(),
      email: normalizedEmail,
      password: data.password,
      keypadId: nextKeypadId,
      role: 'customer',
    })

    await auth.use('web').login(user, true)
    await AuditService.log(user.id, 'user.registered', 'user', user.id, null, {
      via: 'local',
      ip: request.ip(),
      ua: request.header('user-agent') ?? null,
    })
    await AuditService.log(user.id, 'user.login', 'user', user.id, null, {
      via: 'local',
      ip: request.ip(),
      ua: request.header('user-agent') ?? null,
    })

    const notificationService = new NotificationService()
    notificationService.sendWelcomeEmail(user).catch((err) => {
      logger.error({ err }, `Failed to send welcome email to ${user.email}`)
    })

    session.flash('alert', { type: 'success', message: i18n.t('messages.registration_success') })
    return response.redirect('/shop')
  }
}
