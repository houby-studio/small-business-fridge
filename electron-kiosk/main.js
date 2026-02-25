'use strict'

const { app, BrowserWindow, session } = require('electron')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

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
 * Set in snap context:  sudo snap set sbf-kiosk kiosk-url=https://your-app.example.com
 * Set in dev context:   KIOSK_URL=https://your-app.example.com npx electron .
 */
function getKioskUrl() {
  if (process.env.SNAP) {
    try {
      const url = execFileSync('snapctl', ['get', 'kiosk-url'], { encoding: 'utf8' }).trim()
      if (url) return url
    } catch {
      // snapctl unavailable or key not yet set — fall through to env var
    }
  }

  const url = process.env.KIOSK_URL
  if (!url) {
    console.error(
      'No kiosk URL configured.\n' +
        '  Snap:  sudo snap set sbf-kiosk kiosk-url=https://your-app.example.com\n' +
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

  const allowedOrigin = parsedUrl.origin

  // Block all new windows / popups
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Restrict in-page navigation to the configured origin only
  win.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin !== allowedOrigin) {
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

  win.loadURL(kioskUrl)
}

// ── App lifecycle ──────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const rawUrl = getKioskUrl()
  if (!rawUrl) {
    app.quit()
    return
  }
  createWindow(rawUrl)
})

// In kiosk mode the app should never fully close — respawn the window if it
// somehow gets destroyed (e.g. after a crash recovery).
app.on('window-all-closed', () => {
  const rawUrl = getKioskUrl()
  if (rawUrl && parseKioskUrl(rawUrl)) {
    createWindow(rawUrl)
  } else {
    app.quit()
  }
})

// Second instance attempted — ignore, single-instance lock already guards this.
app.on('second-instance', () => {})
