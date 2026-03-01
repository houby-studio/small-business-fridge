const DYNAMIC_IMPORT_ERROR_PATTERNS = [
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'Outdated Optimize Dep',
]

const RECOVERY_RELOAD_GUARD_KEY = 'sbf:dynamic-import-recovery:reloaded'
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

export function markDynamicImportRecoveryReloadAttempt(storage?: Storage): boolean {
  if (!storage) return true
  if (storage.getItem(RECOVERY_RELOAD_GUARD_KEY) === '1') return false
  storage.setItem(RECOVERY_RELOAD_GUARD_KEY, '1')
  return true
}

export function clearDynamicImportRecoveryReloadAttempt(storage?: Storage) {
  storage?.removeItem(RECOVERY_RELOAD_GUARD_KEY)
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
