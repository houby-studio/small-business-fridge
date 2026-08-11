import type { HttpContext } from '@adonisjs/core/http'

/**
 * Where to send the browser back to after a mutation performed from a filtered list.
 *
 * Redirecting to the bare list path drops the query string, so the page reloads
 * unfiltered on page 1 while the filter bar still shows the previous filters — the URL
 * and the table end up describing different things. Reusing the referer keeps them in
 * step, but only when it really points at the list in question; anything else (a foreign
 * host, a crafted referer, a direct API call) falls back to the plain path.
 */
export function listRedirectUrl(request: HttpContext['request'], listPath: string): string {
  const referer = request.header('referer') ?? ''

  try {
    const { pathname, search } = new URL(referer, `${request.protocol()}://${request.host()}`)
    if (pathname === listPath) return pathname + search
  } catch {
    // Unparseable referer — fall through to the plain list path.
  }

  return listPath
}
