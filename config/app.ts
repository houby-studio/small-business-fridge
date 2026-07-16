import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/core/http'

/**
 * Parse the TRUST_PROXY env var into a value accepted by AdonisJS / proxy-addr.
 *
 * Supported values (same as proxy-addr + Express):
 *   loopback         – 127.0.0.1 / ::1 (default; no proxy)
 *   uniquelocal      – RFC-1918 ranges; use when nginx is on the same Docker network
 *   true             – trust all proxies (not recommended)
 *   false            – trust no proxy
 *   <ip/cidr>        – e.g. "172.16.0.0/12"
 */
function parseTrustProxy(raw: string | undefined): boolean | string {
  if (!raw || raw === 'loopback') return 'loopback'
  if (raw === 'true') return true
  if (raw === 'false') return false
  return raw
}

/**
 * The configuration settings used by the HTTP server
 */
export const http = defineConfig({
  generateRequestId: true,
  allowMethodSpoofing: true,

  /**
   * Trust the X-Forwarded-* headers from the configured proxy tier.
   * Set TRUST_PROXY=uniquelocal when the app runs behind nginx on the same Docker network.
   */
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),

  /**
   * Enabling async local storage will let you access HTTP context
   * from anywhere inside your application.
   */
  useAsyncLocalStorage: false,

  /**
   * Manage cookies configuration. The settings for the session id cookie are
   * defined inside the "config/session.ts" file.
   */
  cookie: {
    domain: '',
    path: '/',
    maxAge: '2h',
    httpOnly: true,
    secure: app.inProduction,
    sameSite: 'lax',
  },
})
