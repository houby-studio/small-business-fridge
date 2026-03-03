import env from '#start/env'

export type ExternalAuthProvider = 'microsoft' | 'discord'
export type AuthProvider = 'local' | ExternalAuthProvider
export type ProviderEmailVerificationMode = 'always' | 'claim' | 'never'

function parseCommaList(raw: string | undefined, fallback: string[] = []): Set<string> {
  if (raw === undefined) return new Set(fallback)

  return new Set(
    raw
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0)
  )
}

export default class AuthModeService {
  private readonly supportedExternalProviders: ExternalAuthProvider[] = ['microsoft', 'discord']

  getEnabledProviders(): Set<AuthProvider> {
    const configured = parseCommaList(process.env.AUTH_PROVIDERS ?? env.get('AUTH_PROVIDERS'), [
      'local',
    ])
    const providers = new Set<AuthProvider>()

    if (configured.has('local')) {
      providers.add('local')
    }

    for (const provider of this.supportedExternalProviders) {
      if (configured.has(provider)) {
        providers.add(provider)
      }
    }

    if (providers.size === 0) {
      providers.add('local')
    }

    return providers
  }

  getEnabledExternalProviders(): ExternalAuthProvider[] {
    const enabled = this.getEnabledProviders()
    return this.supportedExternalProviders.filter((provider) => enabled.has(provider))
  }

  getDefaultExternalProvider(): ExternalAuthProvider | null {
    return this.getEnabledExternalProviders()[0] ?? null
  }

  isProviderEnabled(provider: ExternalAuthProvider): boolean {
    return this.getEnabledProviders().has(provider)
  }

  isLocalEnabled(): boolean {
    return this.getEnabledProviders().has('local')
  }

  isOidcEnabled(): boolean {
    return this.getEnabledExternalProviders().length > 0
  }

  isLocalLoginDisabled(): boolean {
    return !this.isLocalEnabled()
  }

  isProviderAutoRegisterEnabled(provider: ExternalAuthProvider): boolean {
    const processProviders = parseCommaList(process.env.AUTH_AUTO_REGISTER_PROVIDERS)
    if (processProviders.size > 0) {
      return processProviders.has(provider)
    }

    const configuredProviders = parseCommaList(env.get('AUTH_AUTO_REGISTER_PROVIDERS'))
    if (configuredProviders.size > 0) {
      return configuredProviders.has(provider)
    }
    return false
  }

  isOidcAutoRegisterEnabled(): boolean {
    return this.isProviderAutoRegisterEnabled('microsoft')
  }

  isOidcOnlyMode(): boolean {
    return this.getEnabledExternalProviders().length > 0 && !this.isLocalEnabled()
  }

  getProviderEmailVerificationMode(provider: ExternalAuthProvider): ProviderEmailVerificationMode {
    const envValue =
      provider === 'microsoft'
        ? env.get('AUTH_PROVIDER_MICROSOFT_EMAIL_VERIFICATION_MODE')
        : env.get('AUTH_PROVIDER_DISCORD_EMAIL_VERIFICATION_MODE')

    if (envValue === 'always' || envValue === 'claim' || envValue === 'never') {
      return envValue
    }

    return provider === 'discord' ? 'claim' : 'always'
  }

  isProviderEmailTrusted(
    provider: ExternalAuthProvider,
    claimValue: boolean | null | undefined
  ): boolean {
    const mode = this.getProviderEmailVerificationMode(provider)
    if (mode === 'always') return true
    if (mode === 'never') return false
    return claimValue === true
  }
}
