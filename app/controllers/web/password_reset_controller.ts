import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import {
  changePasswordValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
} from '#validators/auth'
import AuditService from '#services/audit_service'
import NotificationService from '#services/notification_service'
import PasswordResetService from '#services/password_reset_service'
import hash from '@adonisjs/core/services/hash'

export default class PasswordResetController {
  private resets = new PasswordResetService()

  async showForgot({ inertia }: HttpContext) {
    return inertia.render('auth/forgot_password', {})
  }

  async sendReset({ request, response, session, i18n }: HttpContext) {
    const data = await request.validateUsing(forgotPasswordValidator)

    const payload = await this.resets.createToken(data.email)
    if (payload) {
      const notificationService = new NotificationService()
      notificationService.sendPasswordResetEmail(payload).catch((err) => {
        logger.error({ err, email: payload.email }, 'Failed to send password reset email')
      })
    }

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.password_reset_email_sent'),
    })
    return response.redirect('/forgot-password')
  }

  async showReset({ params, inertia, response, session, i18n }: HttpContext) {
    const token = String(params.token)
    const status = await this.resets.validateToken(token)
    if (!status.valid) {
      session.flash('alert', {
        type: 'danger',
        message: i18n.t('messages.password_reset_invalid'),
      })
      return response.redirect('/forgot-password')
    }

    return inertia.render('auth/reset_password', { token })
  }

  async reset({ params, request, response, session, i18n }: HttpContext) {
    const token = String(params.token)
    const data = await request.validateUsing(resetPasswordValidator)

    if (data.password !== data.passwordConfirmation) {
      session.flash('alert', {
        type: 'danger',
        message: i18n.t('auth.bootstrap_password_mismatch'),
      })
      return response.redirect(`/reset-password/${token}`)
    }

    try {
      const user = await this.resets.resetPassword(token, data.password)
      await AuditService.log(user.id, 'user.password_reset', 'user', user.id, null, {
        via: 'password_reset',
        ip: request.ip(),
        ua: request.header('user-agent') ?? null,
      })

      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.password_reset_success'),
      })
      return response.redirect('/login')
    } catch {
      session.flash('alert', {
        type: 'danger',
        message: i18n.t('messages.password_reset_invalid'),
      })
      return response.redirect('/forgot-password')
    }
  }

  async changeAuthenticated({ auth, request, response, session, i18n }: HttpContext) {
    const user = auth.user!
    const data = await request.validateUsing(changePasswordValidator)

    if (data.newPassword !== data.newPasswordConfirmation) {
      session.flash('alert', {
        type: 'danger',
        message: i18n.t('auth.bootstrap_password_mismatch'),
      })
      return response.redirect('/profile')
    }

    if (user.password) {
      const currentPassword = data.currentPassword ?? ''
      const matches = await hash.verify(user.password, currentPassword)
      if (!matches) {
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.password_current_invalid'),
        })
        return response.redirect('/profile')
      }
    }

    user.password = data.newPassword
    await user.save()

    await AuditService.log(user.id, 'user.password_changed', 'user', user.id, null, {
      via: 'profile',
      ip: request.ip(),
      ua: request.header('user-agent') ?? null,
    })

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.password_changed'),
    })
    return response.redirect('/profile')
  }
}
