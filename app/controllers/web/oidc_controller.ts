import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import User from '#models/user'
import AuditService from '#services/audit_service'
import NotificationService from '#services/notification_service'
import OidcIdentityService from '#services/oidc_identity_service'
import RegistrationPolicyService from '#services/registration_policy_service'
import env from '#start/env'

export default class OidcController {
  private oidcIdentity = new OidcIdentityService()
  private registrationPolicy = new RegistrationPolicyService()

  async redirect({ ally }: HttpContext) {
    return ally.use('microsoft').redirect()
  }

  async callback({ ally, auth, request, response, session, i18n }: HttpContext) {
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

    // Get user info from Microsoft Graph (/me response — raw fields, no Ally normalization)
    const msUser: any = await microsoft.user()
    const oid = msUser.id as string // Azure AD object ID (unique, stable)
    const email =
      (msUser.mail as string | null) || (msUser.userPrincipalName as string | null) || ''
    const displayName = (msUser.displayName as string | null) || email.split('@')[0]
    const phone = (msUser.mobilePhone as string | null) || null

    // Resolve identity safely and reject ambiguous mappings.
    const identityMatch = await this.oidcIdentity.resolve({ oid, email })
    let user = identityMatch.kind === 'matched' ? identityMatch.user : null

    if (identityMatch.kind === 'ambiguous_email') {
      logger.warn(
        { email: identityMatch.email, userIds: identityMatch.userIds },
        'OIDC login denied: multiple local users share the same email'
      )
      session.flash('alert', { type: 'danger', message: i18n.t('messages.login_failed') })
      return response.redirect('/login')
    }

    if (identityMatch.kind === 'oid_conflict') {
      logger.warn(
        { email: identityMatch.email, userId: identityMatch.userId, oid },
        'OIDC login denied: OID conflicts with existing user mapping'
      )
      session.flash('alert', { type: 'danger', message: i18n.t('messages.login_failed') })
      return response.redirect('/login')
    }

    if (identityMatch.kind === 'missing_oid') {
      logger.warn(
        { email: identityMatch.email },
        'OIDC login denied: provider did not return OID for email fallback'
      )
      session.flash('alert', { type: 'danger', message: i18n.t('messages.login_failed') })
      return response.redirect('/login')
    }

    if (!user) {
      if (!oid || !email) {
        logger.warn(
          { oidPresent: !!oid, emailPresent: !!email },
          'OIDC login denied: provider payload missing required identity fields'
        )
        session.flash('alert', { type: 'danger', message: i18n.t('messages.login_failed') })
        return response.redirect('/login')
      }

      if (!env.get('OIDC_AUTO_REGISTER', false)) {
        logger.warn({ email }, 'OIDC login denied: user not found in app')
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.login_not_registered'),
        })
        return response.redirect('/login')
      }

      const registration = this.registrationPolicy.canSelfRegister({
        provider: 'oidc',
        email,
      })
      if (!registration.allowed) {
        logger.warn(
          { email, reason: registration.reason, mode: this.registrationPolicy.getMode() },
          'OIDC login denied: self-registration policy rejected user'
        )
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.login_not_registered'),
        })
        return response.redirect('/login')
      }

      // Auto-register new user
      const hasAnyAdmin = !!(await User.query().where('role', 'admin').first())
      const maxKeypad = await User.query().max('keypad_id as max').first()
      const nextKeypadId = (maxKeypad?.$extras.max ?? 0) + 1

      user = await User.create({
        oid,
        email,
        displayName,
        phone,
        role: hasAnyAdmin ? 'customer' : 'admin',
        keypadId: nextKeypadId,
      })

      logger.info({ userId: user.id, email, role: user.role }, 'OIDC auto-registered new user')

      // Send welcome email (fire-and-forget)
      const notificationService = new NotificationService()
      notificationService.sendWelcomeEmail(user).catch((err) => {
        logger.error({ err }, `Failed to send welcome email to ${email}`)
      })

      await AuditService.log(user.id, 'user.registered', 'user', user.id, null, {
        via: 'oidc',
        ip: request.ip(),
        ua: request.header('user-agent') ?? null,
      })
      session.flash('alert', { type: 'success', message: i18n.t('messages.login_auto_registered') })
    }

    if (user.isDisabled) {
      logger.warn({ oid, email }, 'OIDC login denied: account disabled')
      session.flash('alert', { type: 'danger', message: i18n.t('messages.account_disabled') })
      return response.redirect('/login')
    }

    // Sync fields from Microsoft if missing or changed
    let dirty = false
    if (!user.oid) {
      user.oid = oid
      dirty = true
    }
    if (displayName && user.displayName !== displayName) {
      user.displayName = displayName
      dirty = true
    }
    if (email && user.email !== email) {
      const emailTaken = await User.query()
        .whereRaw('LOWER(email) = ?', [email.toLowerCase()])
        .whereNot('id', user.id)
        .first()

      if (emailTaken) {
        logger.warn(
          { userId: user.id, email, emailTakenBy: emailTaken.id },
          'OIDC email sync skipped: target email is already used by another user'
        )
      } else {
        user.email = email
        dirty = true
      }
    }
    if (phone && !user.phone) {
      user.phone = phone
      dirty = true
    }
    if (dirty) await user.save()

    // Always remember for OIDC — user already authenticated with Microsoft, no reason to expire session
    await auth.use('web').login(user, true)
    logger.info({ userId: user.id, email }, 'OIDC login success')
    await AuditService.log(user.id, 'user.login', 'user', user.id, null, {
      via: 'oidc',
      ip: request.ip(),
      ua: request.header('user-agent') ?? null,
    })
    return response.redirect('/shop')
  }
}
