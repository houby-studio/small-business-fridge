const DYNAMIC_IMPORT_ERROR_PATTERNS = [
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'Outdated Optimize Dep',
]

const RECOVERY_RELOAD_GUARD_KEY = 'sbf:dynamic-import-recovery:last-reload-at'
const RECOVERY_RELOAD_COOLDOWN_MS = 60_000
const INSTALL_GUARD_KEY = '__sbfDynamicImportRecoveryInstalled'

function normalizeErrorMessage(reason: unknown): string {
  if (typeof reason === 'string') {
    return reason
  }

  if (reason && typeof reason === 'object') {
    const maybeMessage = (reason as { message?: unknown }).message
    if (typeof maybeMessage === 'string') {
      return maybeMessage
    }
  }

  return ''
}

export function shouldRecoverFromDynamicImportError(reason: unknown): boolean {
  const message = normalizeErrorMessage(reason)
  if (!message) return false

  return DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) => message.includes(pattern))
}

export function markDynamicImportRecoveryReloadAttempt(
  storage?: Storage,
  now = Date.now(),
  cooldownMs = RECOVERY_RELOAD_COOLDOWN_MS
): boolean {
  if (!storage) return true

  const lastReloadRaw = storage.getItem(RECOVERY_RELOAD_GUARD_KEY)
  const lastReloadAt = lastReloadRaw ? Number.parseInt(lastReloadRaw, 10) : Number.NaN

  if (Number.isFinite(lastReloadAt) && now - lastReloadAt < cooldownMs) return false

  storage.setItem(RECOVERY_RELOAD_GUARD_KEY, `${now}`)
  return true
}

export function installDynamicImportRecovery(windowObject: Window) {
  const withInstallGuard = windowObject as Window & { [INSTALL_GUARD_KEY]?: boolean }
  if (withInstallGuard[INSTALL_GUARD_KEY]) return
  withInstallGuard[INSTALL_GUARD_KEY] = true

  const reloadSafely = () => {
    if (!markDynamicImportRecoveryReloadAttempt(windowObject.sessionStorage)) return
    windowObject.location.reload()
  }

  windowObject.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    reloadSafely()
  })

  windowObject.addEventListener('unhandledrejection', (event) => {
    if (!shouldRecoverFromDynamicImportError(event.reason)) return
    event.preventDefault()
    reloadSafely()
  })
}
