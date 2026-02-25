import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

function mergeVary(current: string | null, additions: string[]): string {
  const values = new Set(
    (current ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  )

  for (const value of additions) {
    values.add(value)
  }

  return Array.from(values).join(', ')
}

/**
 * Prevent intermediary caches from serving user-specific pages across sessions.
 */
export default class CacheGuardMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    await next()

    const path = ctx.request.url()
    if (path.startsWith('/uploads/')) {
      return
    }

    ctx.response.header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    ctx.response.header('Pragma', 'no-cache')
    ctx.response.header('Expires', '0')

    const currentVary = ctx.response.getHeader('Vary')
    const varyHeader = Array.isArray(currentVary)
      ? currentVary.join(', ')
      : String(currentVary ?? '')
    ctx.response.header('Vary', mergeVary(varyHeader, ['Cookie', 'Authorization', 'X-Inertia']))
  }
}
