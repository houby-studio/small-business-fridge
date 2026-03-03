import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import User from '#models/user'
import AuditService from '#services/audit_service'
import NotificationService from '#services/notification_service'
import RegistrationPolicyService from '#services/registration_policy_service'
import InvitationService from '#services/invitation_service'
import AuthModeService, { type ExternalAuthProvider } from '#services/auth_mode_service'
import AuthIdentityService from '#services/auth_identity_service'
import ExternalProfileSyncService from '#services/external_profile_sync_service'
import EmailVerificationService from '#services/email_verification_service'
import ReauthStepupService from '#services/reauth_stepup_service'

export default class OidcController {
  private static readonly BOOTSTRAP_INTENT_KEY = 'oauthBootstrapFirstAdminIntent'
  private static readonly INVITE_INTENT_TOKEN_KEY = 'oauthInviteIntentToken'
  private static readonly LINK_INTENT_KEY = 'oauthLinkIntent'
  private static readonly REAUTH_INTENT_KEY = 'oauthReauthIntent'
  private static readonly LINK_STEPUP_GRANT_KEY = '__oidc_link_stepup_grant'

  private authIdentity = new AuthIdentityService()
  private registrationPolicy = new RegistrationPolicyService()
  private invitations = new InvitationService()
  private authModes = new AuthModeService()
  private externalProfileSync = new ExternalProfileSyncService()
  private verifications = new EmailVerificationService()
  private stepup = new ReauthStepupService()

  private readLinkStepupGrant(session: HttpContext['session']) {
    const raw = session.pull(OidcController.LINK_STEPUP_GRANT_KEY, null)
    if (!raw || typeof raw !== 'object') return null

    const grant = raw as { userId?: unknown; provider?: unknown; issuedAt?: unknown }
    if (typeof grant.userId !== 'number') return null
    if (grant.provider !== 'microsoft' && grant.provider !== 'discord') return null
    if (typeof grant.issuedAt !== 'string' || grant.issuedAt.length === 0) return null

    const issuedAt = DateTime.fromISO(grant.issuedAt, { zone: 'utc' })
    if (!issuedAt.isValid) return null

    return {
      userId: grant.userId,
      provider: grant.provider,
      issuedAt,
    }
  }

  private resolveProvider(input: unknown): ExternalAuthProvider | null {
    const provider = String(input ?? '')
      .trim()
      .toLowerCase()
    if (provider !== 'microsoft' && provider !== 'discord') return null
    return provider
  }

  private providerLabel(provider: ExternalAuthProvider): string {
    return provider === 'microsoft' ? 'Microsoft' : 'Discord'
  }

  private getProviderProfile(
    provider: ExternalAuthProvider,
    providerUser: any
  ): {
    providerUserId: string | null
    email: string | null
    displayName: string | null
    phone: string | null
    emailVerifiedClaim: boolean | null
  } {
    if (provider === 'microsoft') {
      const email = (
        (providerUser.mail as string | null) ||
        (providerUser.userPrincipalName as string | null) ||
        ''
      )
        ?.trim()
        .toLowerCase()
      return {
        providerUserId: (providerUser.id as string | null) ?? null,
        email: email || null,
        displayName: (providerUser.displayName as string | null) ?? null,
        phone: (providerUser.mobilePhone as string | null) ?? null,
        emailVerifiedClaim: null,
      }
    }

    const email = ((providerUser.email as string | null) || '').trim().toLowerCase()
    return {
      providerUserId: (providerUser.id as string | null) ?? null,
      email: email || null,
      displayName:
        (providerUser.global_name as string | null) ||
        (providerUser.username as string | null) ||
        null,
      phone: null,
      emailVerifiedClaim: providerUser.verified === true,
    }
  }

  private async hasAnyAdmin(): Promise<boolean> {
    const admin = await User.query().where('role', 'admin').first()
    return !!admin
  }

  async redirect({ ally, auth, request, response, session, i18n }: HttpContext) {
    const provider = this.resolveProvider(request.param('provider'))
    if (!provider || !this.authModes.isProviderEnabled(provider)) {
      return response.redirect('/login')
    }

    if (request.input('intent') === 'bootstrap' && !(await this.hasAnyAdmin())) {
      session.put(OidcController.BOOTSTRAP_INTENT_KEY, true)
    }

    if (request.input('intent') === 'invite') {
      const token = String(request.input('token') ?? '')
      const status = await this.invitations.validateToken(token)
      if (!status.valid) {
        return response.redirect('/login')
      }

      session.put(OidcController.INVITE_INTENT_TOKEN_KEY, token)
    }

    if (request.input('intent') === 'link') {
      if (session.get('__impersonation')) {
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.sensitive_action_blocked_while_impersonating'),
        })
        return response.redirect('/profile')
      }

      const currentUser = auth.user
      const grant = this.readLinkStepupGrant(session)
      const hasFreshGrant =
        !!currentUser &&
        !!grant &&
        grant.userId === currentUser.id &&
        grant.provider === provider &&
        DateTime.utc().diff(grant.issuedAt, 'minutes').minutes <= 5

      if (!hasFreshGrant && !this.stepup.isRecent(session)) {
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.sensitive_action_reauth_required'),
        })
        return response.redirect('/profile')
      }

      if (!currentUser) {
        session.flash('alert', { type: 'danger', message: i18n.t('messages.forbidden') })
        return response.redirect('/login')
      }

      session.put(OidcController.LINK_INTENT_KEY, { userId: currentUser.id, provider })
    }

    if (request.input('intent') === 'reauth') {
      const currentUser = auth.user
      if (!currentUser) {
        return response.redirect('/login')
      }
      const returnTo = String(request.input('returnTo') ?? '/profile')
      session.put(OidcController.REAUTH_INTENT_KEY, {
        userId: currentUser.id,
        provider,
        returnTo,
      })
    }

    return ally.use(provider).redirect()
  }

  async callback({ ally, auth, request, response, session, i18n }: HttpContext) {
    const provider = this.resolveProvider(request.param('provider'))
    if (!provider || !this.authModes.isProviderEnabled(provider)) {
      return response.redirect('/login')
    }

    const hasAnyAdmin = await this.hasAnyAdmin()
    const bootstrapIntent = session.pull(OidcController.BOOTSTRAP_INTENT_KEY, false) === true
    const allowBootstrapRegistration = bootstrapIntent && !hasAnyAdmin
    const inviteIntentToken = session.pull(OidcController.INVITE_INTENT_TOKEN_KEY, null)
    const inviteIntentStatus =
      typeof inviteIntentToken === 'string' && inviteIntentToken.length > 0
        ? await this.invitations.validateToken(inviteIntentToken)
        : null
    const inviteIntentInvitation = inviteIntentStatus?.valid ? inviteIntentStatus.invitation : null
    const linkIntent = session.pull(OidcController.LINK_INTENT_KEY, null)
    const reauthIntent = session.pull(OidcController.REAUTH_INTENT_KEY, null)
    const hasLinkIntent =
      !!linkIntent &&
      typeof linkIntent === 'object' &&
      Number(linkIntent.userId) > 0 &&
      linkIntent.provider === provider
    const hasReauthIntent =
      !!reauthIntent &&
      typeof reauthIntent === 'object' &&
      Number(reauthIntent.userId) > 0 &&
      reauthIntent.provider === provider

    const externalProvider = ally.use(provider)

    if (externalProvider.accessDenied()) {
      logger.warn({ provider }, 'External login cancelled by user')
      session.flash('alert', { type: 'warning', message: i18n.t('messages.login_cancelled') })
      return response.redirect('/login')
    }

    if (externalProvider.stateMisMatch()) {
      logger.warn({ provider }, 'External login state mismatch')
      session.flash('alert', { type: 'danger', message: i18n.t('messages.login_state_mismatch') })
      return response.redirect('/login')
    }

    if (externalProvider.hasError()) {
      logger.error({ provider }, 'External provider error')
      session.flash('alert', { type: 'danger', message: i18n.t('messages.login_failed') })
      return response.redirect('/login')
    }

    let providerUser: any
    try {
      providerUser = await externalProvider.user()
    } catch (error) {
      logger.error({ err: error, provider }, 'External provider user info request failed')
      session.flash('alert', {
        type: 'danger',
        message: i18n.t('messages.login_provider_unavailable'),
      })
      return response.redirect('/login')
    }
    const profile = this.getProviderProfile(provider, providerUser)
    const providerUserId = profile.providerUserId?.trim() || null
    const email = profile.email?.trim().toLowerCase() || null
    const displayName = profile.displayName || (email ? email.split('@')[0] : null)
    const phone = profile.phone ?? null
    const providerEmailTrusted = this.authModes.isProviderEmailTrusted(
      provider,
      profile.emailVerifiedClaim
    )

    if (!providerUserId) {
      logger.warn({ provider }, 'External login denied: provider payload missing identity id')
      session.flash('alert', { type: 'danger', message: i18n.t('messages.login_failed') })
      return response.redirect('/login')
    }

    if (hasReauthIntent) {
      const identityMatch = await this.authIdentity.resolveForLogin({
        provider,
        providerUserId,
        email,
      })
      if (
        identityMatch.kind !== 'matched' ||
        identityMatch.user.id !== Number(reauthIntent.userId)
      ) {
        session.flash('alert', { type: 'danger', message: i18n.t('messages.login_failed') })
        return response.redirect('/profile')
      }

      this.stepup.markNow(session)
      this.stepup.markOneTimeGrant(session, Number(reauthIntent.userId))
      session.flash('alert', { type: 'success', message: i18n.t('messages.reauth_success') })
      session.flash('sensitiveReauthCompleted', true)
      const returnTo =
        typeof reauthIntent.returnTo === 'string' && reauthIntent.returnTo.length > 0
          ? reauthIntent.returnTo
          : '/profile'
      return response.redirect(returnTo)
    }

    if (hasLinkIntent) {
      if (session.get('__impersonation')) {
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.sensitive_action_blocked_while_impersonating'),
        })
        return response.redirect('/profile')
      }

      const currentUser = auth.user
      if (!currentUser || currentUser.id !== Number(linkIntent.userId)) {
        session.flash('alert', { type: 'danger', message: i18n.t('messages.forbidden') })
        return response.redirect('/profile')
      }

      try {
        await this.authIdentity.ensureLinkedIdentity({
          userId: currentUser.id,
          provider,
          providerUserId,
          providerEmail: email,
          providerEmailVerified: providerEmailTrusted,
        })

        if (
          providerEmailTrusted &&
          email &&
          currentUser.email.toLowerCase() === email &&
          !currentUser.emailVerifiedAt
        ) {
          currentUser.emailVerifiedAt = DateTime.utc()
          await currentUser.save()
        }

        await AuditService.log(
          currentUser.id,
          'user.identity.linked',
          'user',
          currentUser.id,
          null,
          {
            via: provider,
            provider,
            providerUserId,
            ip: request.ip(),
            ua: request.header('user-agent') ?? null,
          }
        )
        session.flash('alert', {
          type: 'success',
          message: i18n.t('messages.profile_updated'),
        })
      } catch (error) {
        logger.warn(
          { err: error, provider, userId: currentUser.id },
          'External identity link failed'
        )
        const isAlreadyLinked =
          error instanceof Error && error.message === 'PROVIDER_IDENTITY_ALREADY_LINKED'
        session.flash('alert', {
          type: 'danger',
          message: i18n.t(
            isAlreadyLinked ? 'messages.oidc_already_linked' : 'messages.login_failed'
          ),
        })
      }

      return response.redirect('/profile')
    }

    const identityMatch = await this.authIdentity.resolveForLogin({
      provider,
      providerUserId,
      email,
    })
    let user = identityMatch.kind === 'matched' ? identityMatch.user : null

    if (identityMatch.kind === 'ambiguous_email') {
      logger.warn(
        { provider, email: identityMatch.email, userIds: identityMatch.userIds },
        'External login denied: multiple local users share the same email'
      )
      session.flash('alert', { type: 'danger', message: i18n.t('messages.login_failed') })
      return response.redirect('/login')
    }

    if (identityMatch.kind === 'provider_conflict') {
      logger.warn(
        { provider, userId: identityMatch.userId },
        'External login denied: provider identity conflicts with existing mapping'
      )
      session.flash('alert', { type: 'danger', message: i18n.t('messages.login_failed') })
      return response.redirect('/login')
    }

    if (!user) {
      if (!email) {
        logger.warn(
          { provider, emailPresent: !!email },
          'External login denied: provider payload missing required email for first login'
        )
        session.flash('alert', { type: 'danger', message: i18n.t('messages.login_failed') })
        return response.redirect('/login')
      }

      if (
        !this.authModes.isProviderAutoRegisterEnabled(provider) &&
        !allowBootstrapRegistration &&
        !inviteIntentInvitation
      ) {
        logger.warn({ provider, email }, 'External login denied: user not found in app')
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.login_not_registered'),
        })
        return response.redirect('/login')
      }

      let invitation = null
      if (inviteIntentInvitation) {
        if (inviteIntentInvitation.email !== email) {
          logger.warn(
            { provider, email, inviteEmail: inviteIntentInvitation.email },
            'External login denied: invite token email does not match provider identity'
          )
          session.flash('alert', {
            type: 'danger',
            message: i18n.t('messages.login_not_registered'),
          })
          return response.redirect('/login')
        }

        invitation = inviteIntentInvitation
      } else if (!allowBootstrapRegistration) {
        const registration = this.registrationPolicy.canSelfRegister({
          provider: 'social',
          email,
        })
        if (!registration.allowed && registration.reason === 'invite_required') {
          invitation = await this.invitations.findActiveByEmail(email)
        }
        if (!registration.allowed && !invitation) {
          logger.warn(
            {
              provider,
              email,
              reason: registration.reason,
              mode: this.registrationPolicy.getMode(),
            },
            'External login denied: self-registration policy rejected user'
          )
          session.flash('alert', {
            type: 'danger',
            message: i18n.t('messages.login_not_registered'),
          })
          return response.redirect('/login')
        }
      }

      // Auto-register new user
      const maxKeypad = await User.query().max('keypad_id as max').first()
      const nextKeypadId = (maxKeypad?.$extras.max ?? 0) + 1

      user = await User.create({
        email,
        displayName: displayName || email.split('@')[0],
        phone,
        role: allowBootstrapRegistration
          ? 'admin'
          : (invitation?.role ?? (hasAnyAdmin ? 'customer' : 'admin')),
        keypadId: nextKeypadId,
        emailVerifiedAt: DateTime.utc(),
        pendingEmail: null,
      })

      if (invitation) {
        await this.invitations.acceptInviteForUser(invitation.id, user.id)
        await AuditService.log(
          user.id,
          'invitation.accepted',
          'user_invitation',
          invitation.id,
          user.id,
          {
            via: provider,
            ip: request.ip(),
            ua: request.header('user-agent') ?? null,
          }
        )
      }

      logger.info(
        { provider, userId: user.id, email, role: user.role },
        'External provider auto-registered new user'
      )

      // Send welcome email (fire-and-forget)
      const notificationService = new NotificationService()
      notificationService.sendWelcomeEmail(user).catch((err) => {
        logger.error({ err }, `Failed to send welcome email to ${email}`)
      })

      await AuditService.log(user.id, 'user.registered', 'user', user.id, null, {
        via: provider,
        ip: request.ip(),
        ua: request.header('user-agent') ?? null,
      })
      session.flash('alert', {
        type: 'success',
        message: allowBootstrapRegistration
          ? i18n.t('messages.bootstrap_admin_created')
          : i18n.t('messages.login_auto_registered'),
      })
    }

    await this.authIdentity.ensureLinkedIdentity({
      userId: user.id,
      provider,
      providerUserId,
      providerEmail: email,
      providerEmailVerified: providerEmailTrusted,
    })

    if (
      providerEmailTrusted &&
      email &&
      user.email.toLowerCase() === email &&
      !user.emailVerifiedAt
    ) {
      user.emailVerifiedAt = DateTime.utc()
      await user.save()
    }

    if (user.isDisabled) {
      logger.warn({ provider, providerUserId, email }, 'External login denied: account disabled')
      session.flash('alert', { type: 'danger', message: i18n.t('messages.account_disabled') })
      return response.redirect('/login')
    }

    await this.externalProfileSync.syncAfterExternalLogin(user, { phone })

    // Always remember for external providers.
    await auth.use('web').login(user, true)
    logger.info({ provider, userId: user.id, email }, 'External login success')
    await AuditService.log(user.id, 'user.login', 'user', user.id, null, {
      via: provider,
      provider: this.providerLabel(provider),
      ip: request.ip(),
      ua: request.header('user-agent') ?? null,
    })
    if (this.verifications.shouldBlockAppAccess(user)) {
      session.flash('alert', {
        type: 'warning',
        message: i18n.t('messages.email_verification_required'),
      })
      return response.redirect('/profile')
    }
    return response.redirect('/shop')
  }
}
