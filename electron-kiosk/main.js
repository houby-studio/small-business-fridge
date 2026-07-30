'use strict'

const { app, BrowserWindow, session, ipcMain } = require('electron')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { listAudioDevices } = require('./audio_devices')

const CONSOLE_LEVEL_TO_METHOD = {
  0: 'info',
  1: 'warn',
  2: 'error',
  3: 'log',
  4: 'debug',
}

function parseAllowedOrigins(rawList) {
  if (!rawList) return []
  const candidates = String(rawList)
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)

  const origins = new Set()
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        console.warn(`Ignoring non-http(s) allowed origin: ${candidate}`)
        continue
      }
      origins.add(parsed.origin)
    } catch {
      console.warn(`Ignoring invalid allowed origin: ${candidate}`)
    }
  }
  return [...origins]
}

function getAdditionalAllowedOrigins() {
  let fromSnap = ''
  if (process.env.SNAP) {
    try {
      fromSnap = execFileSync('snapctl', ['get', 'allowed-origins'], { encoding: 'utf8' }).trim()
    } catch {
      // snapctl unavailable or key not set
    }
  }

  const fromEnv = process.env.KIOSK_ALLOWED_ORIGINS || ''
  return parseAllowedOrigins([fromSnap, fromEnv].filter(Boolean).join(','))
}

// ── Wayland/Ozone hint must be set before app is ready ────────────────────────
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
}

// ── Single-instance lock ───────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// ── URL resolution ─────────────────────────────────────────────────────────────

/**
 * Read the kiosk URL from snap configuration (when running as a snap) or from
 * the KIOSK_URL environment variable (dev/non-snap usage).
 *
 * Set in snap context:  sudo snap set sbf-kiosk url=https://your-app.example.com
 * Set in dev context:   KIOSK_URL=https://your-app.example.com npx electron .
 */
function getKioskUrl() {
  if (process.env.SNAP) {
    try {
      const url = execFileSync('snapctl', ['get', 'url'], { encoding: 'utf8' }).trim()
      if (url) return url
    } catch {
      // snapctl unavailable or key not yet set — fall through to env var
    }
  }

  const url = process.env.KIOSK_URL
  if (!url) {
    console.error(
      'No kiosk URL configured.\n' +
        '  Snap:  sudo snap set sbf-kiosk url=https://your-app.example.com\n' +
        '  Dev:   KIOSK_URL=https://your-app.example.com npx electron .'
    )
    return null
  }
  return url
}

function parseKioskUrl(raw) {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new Error('protocol must be http or https')
    }
    return u
  } catch (err) {
    console.error(`Invalid kiosk URL "${raw}": ${err.message}`)
    return null
  }
}

// ── Onboarding (first-run setup) ───────────────────────────────────────────────

function snapctlGetSilent(key) {
  return execFileSync('snapctl', ['get', key], { encoding: 'utf8' }).trim()
}

function isOnboardingFrame(event) {
  // Reject any IPC call that did not originate from a local file:// frame.
  // This prevents a BrowserWindow that somehow acquired the onboarding preload
  // from invoking these handlers while displaying a remote URL.
  const url = event.senderFrame?.url ?? ''
  return url.startsWith('file://')
}

function registerIpcHandlers() {
  ipcMain.handle('get-config', (event) => {
    if (!isOnboardingFrame(event)) return {}
    const audioInventory = listAudioDevices()

    if (!process.env.SNAP) {
      return {
        audioDevices: audioInventory.devices,
        audioDevicesRaw: audioInventory.rawOutput,
        audioDevicesError: audioInventory.error,
        audioDevicesStatus: audioInventory.status,
      }
    }
    try {
      return {
        url: snapctlGetSilent('url'),
        allowedOrigins: snapctlGetSilent('allowed-origins'),
        lang: snapctlGetSilent('lang'),
        audioSink: snapctlGetSilent('audio-sink'),
        audioVolume: snapctlGetSilent('audio-volume'),
        daemon: snapctlGetSilent('daemon'),
        audioDevices: audioInventory.devices,
        audioDevicesRaw: audioInventory.rawOutput,
        audioDevicesError: audioInventory.error,
        audioDevicesStatus: audioInventory.status,
      }
    } catch {
      return {
        audioDevices: audioInventory.devices,
        audioDevicesRaw: audioInventory.rawOutput,
        audioDevicesError: audioInventory.error,
        audioDevicesStatus: audioInventory.status,
      }
    }
  })

  ipcMain.handle('save-config', (event, config) => {
    if (!isOnboardingFrame(event)) {
      return { success: false, error: 'Unauthorized' }
    }

    // Validate URL in the main process — do not rely solely on renderer validation.
    let parsedUrl
    try {
      parsedUrl = new URL(String(config.url ?? ''))
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return { success: false, error: 'URL must use http or https' }
      }
    } catch {
      return { success: false, error: 'Invalid URL' }
    }

    try {
      if (process.env.SNAP) {
        execFileSync('snapctl', [
          'set',
          `url=${parsedUrl.href}`,
          `allowed-origins=${config.allowedOrigins ?? ''}`,
          `lang=${config.lang ?? 'en'}`,
          `audio-sink=${config.audioSink ?? 'auto'}`,
          `audio-volume=${config.audioVolume ?? '100'}`,
          `daemon=${config.daemon ?? 'true'}`,
        ])
      }
      // Quit after a short pause so the renderer can show the success message.
      // In snap daemon mode the service manager will restart the process automatically.
      // In dev mode we relaunch with the new URL in the environment.
      setTimeout(() => {
        if (!process.env.SNAP) {
          process.env.KIOSK_URL = parsedUrl.href
          app.relaunch()
        }
        app.quit()
      }, 2500)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err.message) }
    }
  })
}

let onboardingOpen = false

function createOnboardingWindow() {
  onboardingOpen = true
  const win = new BrowserWindow({
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'onboarding-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Block popups and prevent any navigation away from the local setup page.
  // If the window navigated to a remote URL, window.kioskSetup would be
  // present in that remote context and could invoke the config IPC handlers.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  win.loadFile(path.join(__dirname, 'onboarding.html'))
}

// ── Window factory ─────────────────────────────────────────────────────────────
function createWindow(kioskUrl) {
  const parsedUrl = parseKioskUrl(kioskUrl)
  if (!parsedUrl) {
    app.quit()
    return
  }

  const win = new BrowserWindow({
    fullscreen: true,
    kiosk: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // ── Security: Electron recommended settings ──────────────────────────
      contextIsolation: true, // isolate preload from renderer world
      nodeIntegration: false, // no Node.js in renderer
      sandbox: true, // Chromium renderer sandbox
      webSecurity: true, // enforce same-origin policy
      allowRunningInsecureContent: false, // no mixed content
      navigateOnDragDrop: false, // prevent drag-drop navigation
      // ── UX ───────────────────────────────────────────────────────────────
      spellcheck: false,
    },
  })

  const allowedOrigins = new Set([parsedUrl.origin, ...getAdditionalAllowedOrigins()])
  console.log(`Allowed navigation origins: ${[...allowedOrigins].join(', ')}`)

  // Block all new windows / popups
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Restrict in-page navigation to the configured origin only
  win.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      if (!allowedOrigins.has(new URL(targetUrl).origin)) {
        event.preventDefault()
        console.warn(`Blocked navigation to: ${targetUrl}`)
      }
    } catch {
      event.preventDefault()
    }
  })

  // Block permission requests (camera, microphone, notifications, …)
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })

  // Intercept keystrokes that could exit kiosk mode
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (
      input.key === 'Escape' ||
      input.key === 'F11' ||
      (input.alt && input.key === 'F4') || // Windows/Linux close
      (input.meta && input.key === 'q') // macOS quit
    ) {
      event.preventDefault()
    }
  })

  // Lock out DevTools in packaged builds
  if (app.isPackaged) {
    win.webContents.on('devtools-opened', () => win.webContents.closeDevTools())
  }

  // Reload renderer on crash rather than showing a blank screen
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Renderer gone (reason: ${details.reason}) — reloading`)
    win.reload()
  })

  win.webContents.on('unresponsive', () => {
    console.warn('Renderer unresponsive — reloading')
    win.reload()
  })

  // Mirror renderer console output into main process logs (useful for snap logs).
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const method = CONSOLE_LEVEL_TO_METHOD[level] ?? 'log'
    const formatted = `[renderer:${method}] ${message} (${sourceId}:${line})`
    if (method === 'error') {
      console.error(formatted)
      return
    }
    if (method === 'warn') {
      console.warn(formatted)
      return
    }
    console.log(formatted)
  })

  win.loadURL(kioskUrl)
}

// ── App lifecycle ──────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  registerIpcHandlers()
  const rawUrl = getKioskUrl()
  if (!rawUrl) {
    createOnboardingWindow()
    return
  }
  createWindow(rawUrl)
})

// In kiosk mode the app should never fully close — respawn the window if it
// somehow gets destroyed (e.g. after a crash recovery).
// If the onboarding window was closed (user cancelled or save triggered quit),
// just quit — the snap daemon will restart the process automatically.
app.on('window-all-closed', () => {
  if (onboardingOpen) {
    app.quit()
    return
  }
  const rawUrl = getKioskUrl()
  if (rawUrl && parseKioskUrl(rawUrl)) {
    createWindow(rawUrl)
  } else {
    app.quit()
  }
})

// Second instance attempted — ignore, single-instance lock already guards this.
app.on('second-instance', () => {})
