import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/core/http'
import proxyaddr from 'proxy-addr'

/**
 * Parse the TRUST_PROXY env var into a value accepted by AdonisJS / proxy-addr.
 *
 * Supported values (same as proxy-addr + Express):
 *   loopback         – 127.0.0.1 / ::1 (default; no proxy)
 *   uniquelocal      – RFC-1918 ranges; use when nginx is on the same Docker network
 *   true             – trust all proxies (not recommended)
 *   false            – trust no proxy
 *   <ip/cidr>        – e.g. "172.16.0.0/12"
 *   <ip/cidr>,<...>  – comma-separated list, e.g. "10.0.0.5,172.64.0.0/13".
 *                      Needed when several proxy tiers sit in front of the app,
 *                      e.g. a local reverse proxy behind Cloudflare — only then
 *                      does request.ip() resolve to the real client instead of
 *                      the nearest untrusted hop.
 *
 * A list must be compiled here: passing the raw "a,b" string on makes
 * proxy-addr throw "invalid IP address" and the app never finishes booting,
 * while an array is rejected by AdonisJS's own types.
 */
export function parseTrustProxy(
  raw: string | undefined
): boolean | string | ((address: string, distance: number) => boolean) {
  if (!raw || raw === 'loopback') return 'loopback'
  if (raw === 'true') return true
  if (raw === 'false') return false

  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  if (entries.length === 0) return 'loopback'
  if (entries.length === 1) return entries[0]
  return proxyaddr.compile(entries)
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
