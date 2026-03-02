import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import IbanChangeService from '#services/iban_change_service'
import NotificationService from '#services/notification_service'

export default class IbanChangeController {
  private ibans = new IbanChangeService()

  async verify({ params, response, session, i18n, auth }: HttpContext) {
    const token = String(params.token ?? '').trim()
    if (!token) {
      session.flash('alert', { type: 'danger', message: i18n.t('messages.iban_change_invalid') })
      return response.redirect('/login')
    }

    const result = await this.ibans.consumeToken(token)
    if (!result.ok) {
      session.flash('alert', { type: 'danger', message: i18n.t('messages.iban_change_invalid') })
      return response.redirect(auth.user ? '/profile' : '/login')
    }

    session.flash('alert', { type: 'success', message: i18n.t('messages.iban_change_verified') })
    return response.redirect(auth.user && auth.user.id === result.user.id ? '/profile' : '/login')
  }

  async resend({ auth, response, session, i18n }: HttpContext) {
    const user = auth.user!
    const payload = await this.ibans.createForPendingIban(user)

    if (!payload) {
      session.flash('alert', {
        type: 'info',
        message: i18n.t('messages.iban_change_already_verified'),
      })
      return response.redirect('/profile')
    }

    const notifications = new NotificationService()
    notifications
      .sendIbanChangeVerificationEmail({
        email: user.email,
        displayName: user.displayName,
        iban: payload.token.iban,
        verificationUrl: payload.verificationUrl,
      })
      .catch((err) => {
        logger.error({ err, userId: user.id }, 'Failed to resend IBAN verification')
      })

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.iban_change_pending_verification'),
    })
    return response.redirect('/profile')
  }
}
