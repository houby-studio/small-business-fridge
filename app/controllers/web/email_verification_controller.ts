import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import NotificationService from '#services/notification_service'
import EmailVerificationService from '#services/email_verification_service'

export default class EmailVerificationController {
  private verifications = new EmailVerificationService()

  async verify({ params, response, session, i18n, auth }: HttpContext) {
    const token = String(params.token ?? '').trim()
    if (!token) {
      session.flash('alert', {
        type: 'danger',
        message: i18n.t('messages.email_verification_invalid'),
      })
      return response.redirect('/login')
    }

    if (auth.user) {
      const ownerId = await this.verifications.inspectTokenOwner(token)
      if (ownerId && ownerId !== auth.user.id) {
        session.flash('alert', { type: 'danger', message: i18n.t('messages.forbidden') })
        return response.redirect('/profile')
      }
    }

    const result = await this.verifications.consumeToken(token)

    if (!result.ok) {
      const messageKey =
        result.reason === 'email_taken'
          ? 'messages.invite_email_already_registered'
          : 'messages.email_verification_invalid'
      session.flash('alert', { type: 'danger', message: i18n.t(messageKey) })
      return response.redirect(auth.user ? '/profile' : '/login')
    }

    session.flash('alert', { type: 'success', message: i18n.t('messages.email_verified_success') })

    if (auth.user && auth.user.id === result.user.id) {
      return response.redirect('/profile')
    }

    return response.redirect('/login')
  }

  async resend({ auth, response, session, i18n }: HttpContext) {
    const user = auth.user!
    const payload = await this.verifications.createForCurrentOrPendingEmail(user)

    if (!payload) {
      session.flash('alert', {
        type: 'info',
        message: i18n.t('messages.email_already_verified'),
      })
      return response.redirect('/profile')
    }

    const notificationService = new NotificationService()
    notificationService
      .sendEmailVerificationEmail({
        email: payload.token.email,
        displayName: user.displayName,
        verificationUrl: payload.verificationUrl,
      })
      .catch((err) => {
        logger.error(
          { err, userId: user.id, email: payload.token.email },
          'Failed to resend email verification'
        )
      })

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.email_verification_sent'),
    })

    return response.redirect('/profile')
  }
}
