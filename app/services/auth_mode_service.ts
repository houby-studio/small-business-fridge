import env from '#start/env'

function parseBoolean(raw: string | undefined): boolean | null {
  if (raw === undefined) return null

  const normalized = raw.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true
  }
  if (
    normalized === 'false' ||
    normalized === '0' ||
    normalized === 'no' ||
    normalized === 'off' ||
    normalized === ''
  ) {
    return false
  }

  return null
}

export default class AuthModeService {
  isOidcEnabled(): boolean {
    const parsed = parseBoolean(process.env.OIDC_ENABLED)
    if (parsed !== null) return parsed
    return env.get('OIDC_ENABLED', false)
  }

  isLocalLoginDisabled(): boolean {
    const parsed = parseBoolean(process.env.LOCAL_LOGIN_DISABLED)
    if (parsed !== null) return parsed
    return env.get('LOCAL_LOGIN_DISABLED', false)
  }

  isOidcAutoRegisterEnabled(): boolean {
    const parsed = parseBoolean(process.env.OIDC_AUTO_REGISTER)
    if (parsed !== null) return parsed
    return env.get('OIDC_AUTO_REGISTER', false)
  }

  isOidcOnlyMode(): boolean {
    return this.isOidcEnabled() && this.isLocalLoginDisabled()
  }
}
