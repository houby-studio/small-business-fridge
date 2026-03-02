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
import AuthModeService from '#services/auth_mode_service'
import ReauthStepupService from '#services/reauth_stepup_service'

export default class PasswordResetController {
  private resets = new PasswordResetService()
  private authModes = new AuthModeService()
  private stepup = new ReauthStepupService()

  async showForgot({ inertia, response }: HttpContext) {
    if (this.authModes.isLocalLoginDisabled()) {
      return response.redirect('/login')
    }

    return inertia.render('auth/forgot_password', {})
  }

  async sendReset({ request, response, session, i18n }: HttpContext) {
    if (this.authModes.isLocalLoginDisabled()) {
      return response.redirect('/login')
    }

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
    if (this.authModes.isLocalLoginDisabled()) {
      return response.redirect('/login')
    }

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
    if (this.authModes.isLocalLoginDisabled()) {
      return response.redirect('/login')
    }

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
    if (this.authModes.isLocalLoginDisabled()) {
      session.flash('alert', {
        type: 'danger',
        message: i18n.t('messages.forbidden'),
      })
      return response.redirect('/profile')
    }

    const user = auth.user!
    const data = await request.validateUsing(changePasswordValidator)

    if (session.get('__impersonation')) {
      session.flash('alert', {
        type: 'danger',
        message: i18n.t('messages.sensitive_action_blocked_while_impersonating'),
      })
      return response.redirect('/profile')
    }

    if (data.newPassword !== data.newPasswordConfirmation) {
      session.flash('alert', {
        type: 'danger',
        message: i18n.t('auth.bootstrap_password_mismatch'),
      })
      return response.redirect('/profile')
    }

    const hasRecentStepup = this.stepup.isRecent(session)
    const hasOneTimeGrant = this.stepup.consumeOneTimeGrant(session, user.id)

    if (!hasRecentStepup && !hasOneTimeGrant) {
      if (user.password) {
        const currentPassword = data.currentPassword ?? null
        const matches = await this.stepup.verifyLocalPasswordStepup(user, currentPassword)
        if (!matches) {
          session.flash('alert', {
            type: 'danger',
            message: i18n.t('messages.password_current_invalid'),
          })
          return response.redirect('/profile')
        }
        this.stepup.markNow(session)
        this.stepup.markOneTimeGrant(session, user.id)
      } else {
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.sensitive_action_reauth_required'),
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
