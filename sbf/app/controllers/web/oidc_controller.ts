import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import User from '#models/user'
import env from '#start/env'

export default class OidcController {
  async redirect({ ally }: HttpContext) {
    return ally.use('microsoft').redirect()
  }

  async callback({ ally, auth, response, session, i18n }: HttpContext) {
    const microsoft = ally.use('microsoft')

    // Handle user cancelling or errors from Microsoft
    if (microsoft.accessDenied()) {
      logger.warn('OIDC login cancelled by user')
      session.flash('alert', { type: 'warning', message: i18n.t('messages.login_cancelled') })
      return response.redirect('/login')
    }

    if (microsoft.stateMisMatch()) {
      logger.warn('OIDC state mismatch')
      session.flash('alert', { type: 'danger', message: i18n.t('messages.login_state_mismatch') })
      return response.redirect('/login')
    }

    if (microsoft.hasError()) {
      logger.error('OIDC provider error')
      session.flash('alert', { type: 'danger', message: i18n.t('messages.login_failed') })
      return response.redirect('/login')
    }

    // Get user info from Microsoft
    const msUser = await microsoft.user()
    const oid = msUser.id // Azure AD object ID (unique, stable)
    const email = msUser.email ?? msUser.original?.userPrincipalName ?? ''
    const displayName = msUser.name ?? email.split('@')[0]

    // Find existing user by OID (preferred) or email fallback
    let user = await User.query().where('oid', oid).first()

    if (!user && email) {
      user = await User.query().where('email', email).first()
    }

    if (!user) {
      if (!env.get('OIDC_AUTO_REGISTER', false)) {
        logger.warn({ email }, 'OIDC login denied: user not found in app')
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.login_not_registered'),
        })
        return response.redirect('/login')
      }

      // Auto-register new user
      const maxKeypad = await User.query().max('keypad_id as max').first()
      const nextKeypadId = (maxKeypad?.$extras.max ?? 0) + 1

      user = await User.create({
        oid,
        email,
        displayName,
        role: 'customer',
        keypadId: nextKeypadId,
      })

      logger.info({ userId: user.id, email }, 'OIDC auto-registered new user')
      session.flash('alert', { type: 'success', message: i18n.t('messages.login_auto_registered') })
    }

    if (user.isDisabled) {
      logger.warn({ oid, email }, 'OIDC login denied: account disabled')
      session.flash('alert', { type: 'danger', message: i18n.t('messages.account_disabled') })
      return response.redirect('/login')
    }

    // Sync OID and display name if changed
    let dirty = false
    if (!user.oid) {
      user.oid = oid
      dirty = true
    }
    if (displayName && user.displayName !== displayName) {
      user.displayName = displayName
      dirty = true
    }
    if (dirty) await user.save()

    await auth.use('web').login(user)
    logger.info({ userId: user.id, email }, 'OIDC login success')
    return response.redirect('/shop')
  }
}
