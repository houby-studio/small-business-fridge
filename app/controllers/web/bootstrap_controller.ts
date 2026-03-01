import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import User from '#models/user'
import { bootstrapAdminValidator } from '#validators/auth'
import AuditService from '#services/audit_service'
import AuthModeService from '#services/auth_mode_service'

export default class BootstrapController {
  private authModes = new AuthModeService()

  private async hasAnyAdmin(): Promise<boolean> {
    const admin = await User.query().where('role', 'admin').first()
    return !!admin
  }

  async show({ inertia, response }: HttpContext) {
    if (await this.hasAnyAdmin()) {
      return response.redirect('/login')
    }

    return inertia.render('auth/bootstrap', {
      localEnabled: this.authModes.isLocalEnabled(),
      externalProviders: this.authModes.getEnabledExternalProviders(),
    })
  }

  async store({ request, auth, response, session, i18n }: HttpContext) {
    if (await this.hasAnyAdmin()) {
      return response.redirect('/login')
    }

    if (this.authModes.isLocalLoginDisabled()) {
      session.flash('alert', {
        type: 'danger',
        message: i18n.t('auth.bootstrap_local_disabled'),
      })
      return response.redirect('/setup/bootstrap')
    }

    const data = await request.validateUsing(bootstrapAdminValidator)
    if (data.password !== data.passwordConfirmation) {
      session.flash('alert', {
        type: 'danger',
        message: i18n.t('auth.bootstrap_password_mismatch'),
      })
      return response.redirect('/setup/bootstrap')
    }

    const maxKeypad = await User.query().max('keypad_id as max').first()
    const nextKeypadId = (maxKeypad?.$extras.max ?? 0) + 1

    const user = await User.create({
      displayName: data.displayName,
      email: data.email.trim().toLowerCase(),
      password: data.password,
      keypadId: nextKeypadId,
      role: 'admin',
    })

    await auth.use('web').login(user, true)
    logger.info({ userId: user.id, email: user.email }, 'Bootstrap: first admin created')

    await AuditService.log(user.id, 'user.registered', 'user', user.id, null, {
      via: 'bootstrap',
      ip: request.ip(),
      ua: request.header('user-agent') ?? null,
    })
    await AuditService.log(user.id, 'user.login', 'user', user.id, null, {
      via: 'bootstrap',
      ip: request.ip(),
      ua: request.header('user-agent') ?? null,
    })

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.bootstrap_admin_created'),
    })
    return response.redirect('/shop')
  }
}
