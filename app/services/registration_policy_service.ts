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
 * Production deployments should explicitly set AUTH_REGISTRATION_MODE
 * (recommended: invite_only).
 */
export default class RegistrationPolicyService {
  constructor(
    private readonly overrides?: {
      mode?: RegistrationMode
      allowedDomains?: string[]
    }
  ) {}

  getMode(): RegistrationMode {
    if (this.overrides?.mode) {
      return this.overrides.mode
    }

    const mode = this.resolveMode()
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

    const allowedDomains = this.allowedDomainsSet()
    if (allowedDomains.size === 0) return { allowed: false, reason: 'domain_not_allowed' }

    return allowedDomains.has(domain)
      ? { allowed: true, reason: 'allowed' }
      : { allowed: false, reason: 'domain_not_allowed' }
  }

  getAllowedDomains(): string[] {
    return [...this.allowedDomainsSet()]
  }

  private allowedDomainsSet(): Set<string> {
    if (this.overrides?.allowedDomains) {
      return new Set(
        this.overrides.allowedDomains
          .map((domain) => domain.trim().toLowerCase())
          .filter((domain) => domain.length > 0)
      )
    }

    const raw = this.resolveAllowedDomainsRaw()
    return new Set(
      raw
        .split(',')
        .map((domain) => domain.trim().toLowerCase())
        .filter((domain) => domain.length > 0)
    )
  }

  private resolveMode(): string {
    const preferredMode = process.env.AUTH_REGISTRATION_MODE ?? env.get('AUTH_REGISTRATION_MODE')
    if (typeof preferredMode === 'string' && preferredMode.trim().length > 0) return preferredMode
    return 'open'
  }

  private resolveAllowedDomainsRaw(): string {
    const preferredDomains =
      process.env.AUTH_REGISTRATION_ALLOWED_DOMAINS ?? env.get('AUTH_REGISTRATION_ALLOWED_DOMAINS')
    if (typeof preferredDomains === 'string') return preferredDomains
    return ''
  }
}
