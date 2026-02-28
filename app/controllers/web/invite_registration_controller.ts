import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { acceptInviteValidator } from '#validators/auth'
import AuditService from '#services/audit_service'
import InvitationService from '#services/invitation_service'
import NotificationService from '#services/notification_service'
import AuthModeService from '#services/auth_mode_service'

export default class InviteRegistrationController {
  private invitations = new InvitationService()
  private authModes = new AuthModeService()

  async show({ inertia, params, response, session, i18n }: HttpContext) {
    if (this.authModes.isOidcOnlyMode()) {
      return response.redirect('/login')
    }

    const token = String(params.token)
    const status = await this.invitations.validateToken(token)

    if (!status.valid) {
      session.flash('alert', {
        type: 'danger',
        message: i18n.t('messages.invite_invalid_or_expired'),
      })
      return response.redirect('/login')
    }

    return inertia.render('auth/invite', {
      token,
      email: status.invitation.email,
      role: status.invitation.role,
      expiresAt: status.invitation.expiresAt.toISO(),
    })
  }

  async store({ params, request, auth, response, session, i18n }: HttpContext) {
    if (this.authModes.isOidcOnlyMode()) {
      return response.redirect('/login')
    }

    const token = String(params.token)
    const data = await request.validateUsing(acceptInviteValidator)

    if (data.password !== data.passwordConfirmation) {
      session.flash('alert', {
        type: 'danger',
        message: i18n.t('auth.bootstrap_password_mismatch'),
      })
      return response.redirect(`/register/invite/${token}`)
    }

    try {
      const user = await this.invitations.acceptInvite({
        token,
        displayName: data.displayName,
        username: data.username,
        password: data.password,
      })

      await auth.use('web').login(user, true)

      await AuditService.log(user.id, 'invitation.accepted', 'user_invitation', null, user.id, {
        via: 'local',
        ip: request.ip(),
        ua: request.header('user-agent') ?? null,
      })
      await AuditService.log(user.id, 'user.registered', 'user', user.id, null, {
        via: 'invite',
        ip: request.ip(),
        ua: request.header('user-agent') ?? null,
      })
      await AuditService.log(user.id, 'user.login', 'user', user.id, null, {
        via: 'invite',
        ip: request.ip(),
        ua: request.header('user-agent') ?? null,
      })

      const notificationService = new NotificationService()
      notificationService.sendWelcomeEmail(user).catch((err) => {
        logger.error({ err }, `Failed to send welcome email to ${user.email}`)
      })

      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.invite_accepted'),
      })
      return response.redirect('/shop')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN'

      if (
        message === 'INVITE_NOT_FOUND' ||
        message === 'INVITE_REVOKED' ||
        message === 'INVITE_ALREADY_ACCEPTED' ||
        message === 'INVITE_EXPIRED'
      ) {
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.invite_invalid_or_expired'),
        })
        return response.redirect('/login')
      }

      if (message === 'EMAIL_ALREADY_REGISTERED') {
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.invite_email_already_registered'),
        })
        return response.redirect('/login')
      }

      if (message === 'USERNAME_ALREADY_TAKEN') {
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.invite_username_taken'),
        })
        return response.redirect(`/register/invite/${token}`)
      }

      throw error
    }
  }
}
