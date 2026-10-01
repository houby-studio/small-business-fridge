import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import type { LookupFunction } from 'node:net'
import { DomainError } from '#services/domain_error'

export type RemoteImageErrorCode =
  | 'image_url_invalid'
  | 'image_url_blocked'
  | 'image_url_unreachable'
  | 'image_url_not_image'
  | 'image_url_too_large'

export interface FetchRemoteImageOptions {
  maxBytes: number
  timeoutMs?: number
  maxRedirects?: number
  /** Only for tests that serve fixtures from localhost. Never set from configuration. */
  allowPrivateNetwork?: boolean
}

/**
 * Addresses a supplier must not be able to make the server fetch: loopback, private,
 * link-local (cloud metadata at 169.254.169.254), CGNAT, multicast and reserved ranges.
 */
const blockList = new net.BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockList.addSubnet(address, prefix, 'ipv4')
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['64:ff9b::', 96],
  ['2002::', 16],
] as const) {
  blockList.addSubnet(address, prefix, 'ipv6')
}

export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address)
  if (family === 0) return true
  if (family === 6) {
    // IPv4-mapped (::ffff:10.0.0.1) — judge the embedded IPv4 address.
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return blockList.check(mapped[1], 'ipv4')
    return blockList.check(address, 'ipv6')
  }
  return blockList.check(address, 'ipv4')
}

/**
 * DNS lookup that refuses blocked addresses. Used as the socket's `lookup`, so the
 * address that is checked is the address that is connected to — no DNS-rebinding gap.
 */
function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0)
      const list = addresses as dns.LookupAddress[]
      const allowed = allowPrivate ? list : list.filter((a) => !isBlockedAddress(a.address))
      if (allowed.length === 0) {
        const blocked = new Error('blocked address') as NodeJS.ErrnoException
        blocked.code = 'EBLOCKED'
        return callback(blocked, '', 0)
      }
      if ((options as dns.LookupOptions).all) {
        return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, allowed)
      }
      callback(null, allowed[0].address, allowed[0].family)
    })
  }
}

function parseUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new DomainError<RemoteImageErrorCode>('image_url_invalid')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DomainError<RemoteImageErrorCode>('image_url_invalid')
  }
  if (url.username || url.password) {
    throw new DomainError<RemoteImageErrorCode>('image_url_invalid')
  }
  return url
}

function requestOnce(
  url: URL,
  options: Required<Omit<FetchRemoteImageOptions, 'maxRedirects'>>
): Promise<{ redirect?: string; buffer?: Buffer }> {
  // A literal IP skips DNS, so check it here as well.
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host) && !options.allowPrivateNetwork && isBlockedAddress(host)) {
    return Promise.reject(new DomainError<RemoteImageErrorCode>('image_url_blocked'))
  }

  const client = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = client.get(
      url,
      {
        lookup: guardedLookup(options.allowPrivateNetwork),
        timeout: options.timeoutMs,
        headers: {
          'User-Agent': 'SmallBusinessFridge/3 (product image fetch)',
          'Accept': 'image/*',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          return resolve({ redirect: new URL(res.headers.location, url).toString() })
        }
        if (status !== 200) {
          res.resume()
          return reject(new DomainError<RemoteImageErrorCode>('image_url_unreachable'))
        }
        const type = String(res.headers['content-type'] ?? '')
        if (!type.toLowerCase().startsWith('image/')) {
          res.resume()
          return reject(new DomainError<RemoteImageErrorCode>('image_url_not_image'))
        }
        const declared = Number(res.headers['content-length'] ?? 0)
        if (declared > options.maxBytes) {
          res.destroy()
          return reject(new DomainError<RemoteImageErrorCode>('image_url_too_large'))
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > options.maxBytes) {
            res.destroy()
            reject(new DomainError<RemoteImageErrorCode>('image_url_too_large'))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks) }))
        res.on('error', () =>
          reject(new DomainError<RemoteImageErrorCode>('image_url_unreachable'))
        )
      }
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (err: NodeJS.ErrnoException) => {
      reject(
        new DomainError<RemoteImageErrorCode>(
          err.code === 'EBLOCKED' ? 'image_url_blocked' : 'image_url_unreachable'
        )
      )
    })
  })
}

/**
 * Downloads an image a supplier pasted a link to. Redirects are followed by hand so every
 * hop goes through the same address check.
 */
export async function fetchRemoteImage(
  rawUrl: string,
  options: FetchRemoteImageOptions
): Promise<Buffer> {
  const resolved = {
    maxBytes: options.maxBytes,
    timeoutMs: options.timeoutMs ?? 15_000,
    allowPrivateNetwork: options.allowPrivateNetwork ?? false,
  }
  let url = parseUrl(rawUrl)
  for (let hop = 0; hop <= (options.maxRedirects ?? 3); hop++) {
    const result = await requestOnce(url, resolved)
    if (result.buffer) return result.buffer
    url = parseUrl(result.redirect!)
  }
  throw new DomainError<RemoteImageErrorCode>('image_url_unreachable')
}
