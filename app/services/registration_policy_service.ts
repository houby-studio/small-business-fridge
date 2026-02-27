import env from '#start/env'

export type RegistrationMode = 'open' | 'invite_only' | 'domain_auto_approve' | 'closed'
export type RegistrationProvider = 'local' | 'oidc' | 'social'

export type RegistrationDecision =
  | { allowed: true; reason: 'allowed' }
  | {
      allowed: false
      reason: 'mode_closed' | 'invite_required' | 'missing_email' | 'domain_not_allowed'
    }

/**
 * Central policy for self-registration across all auth providers.
 *
 * Defaults to `open` to preserve existing behavior when OIDC auto-register is enabled.
 * Production deployments should explicitly set REGISTRATION_MODE (recommended: invite_only).
 */
export default class RegistrationPolicyService {
  getMode(): RegistrationMode {
    const mode = env.get('REGISTRATION_MODE', 'open')
    if (
      mode === 'open' ||
      mode === 'invite_only' ||
      mode === 'domain_auto_approve' ||
      mode === 'closed'
    ) {
      return mode
    }
    return 'open'
  }

  canSelfRegister(params: {
    provider: RegistrationProvider
    email: string | null
  }): RegistrationDecision {
    const mode = this.getMode()

    if (mode === 'open') return { allowed: true, reason: 'allowed' }
    if (mode === 'closed') return { allowed: false, reason: 'mode_closed' }
    if (mode === 'invite_only') return { allowed: false, reason: 'invite_required' }

    const email = params.email?.trim().toLowerCase() || null
    if (!email) return { allowed: false, reason: 'missing_email' }

    const domain = email.split('@')[1]?.trim().toLowerCase()
    if (!domain) return { allowed: false, reason: 'missing_email' }

    const allowedDomains = this.getAllowedDomains()
    if (allowedDomains.size === 0) return { allowed: false, reason: 'domain_not_allowed' }

    return allowedDomains.has(domain)
      ? { allowed: true, reason: 'allowed' }
      : { allowed: false, reason: 'domain_not_allowed' }
  }

  private getAllowedDomains(): Set<string> {
    const raw = env.get('REGISTRATION_ALLOWED_DOMAINS', '')
    return new Set(
      raw
        .split(',')
        .map((domain) => domain.trim().toLowerCase())
        .filter((domain) => domain.length > 0)
    )
  }
}
