import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Simple in-memory rate limiter middleware for API routes.
 *
 * Configuration:
 *   maxRequests: max requests per window (default: 60)
 *   windowMs: time window in milliseconds (default: 60000 = 1 minute)
 *
 * Usage in routes:
 *   middleware.throttle({ maxRequests: 60, windowMs: 60_000 })
 *
 * Returns 429 Too Many Requests with Retry-After header when limit is exceeded.
 */

interface ThrottleOptions {
  maxRequests?: number
  windowMs?: number
}

interface BucketEntry {
  count: number
  resetAt: number
}

export const store = new Map<string, BucketEntry>()

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key)
  }
}, 5 * 60_000).unref()

export default class ThrottleMiddleware {
  async handle(ctx: HttpContext, next: NextFn, options?: ThrottleOptions) {
    const maxRequests = options?.maxRequests ?? 60
    const windowMs = options?.windowMs ?? 60_000

    const key = this.resolveKey(ctx)
    const now = Date.now()

    let bucket = store.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs }
      store.set(key, bucket)
    }

    bucket.count++

    // Set rate limit headers
    const remaining = Math.max(0, maxRequests - bucket.count)
    ctx.response.header('X-RateLimit-Limit', String(maxRequests))
    ctx.response.header('X-RateLimit-Remaining', String(remaining))
    ctx.response.header('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)))

    if (bucket.count > maxRequests) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000)
      ctx.response.header('Retry-After', String(retryAfter))
      return ctx.response.tooManyRequests({
        error: 'Too many requests',
        retryAfter,
      })
    }

    return next()
  }

  private resolveKey(ctx: HttpContext): string {
    // Use auth user ID if available, otherwise fall back to IP
    const userId = ctx.auth?.user?.id
    if (userId) return `throttle:user:${userId}`

    const ip =
      ctx.request.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      ctx.request.ip()

    return `throttle:ip:${ip}`
  }
}
