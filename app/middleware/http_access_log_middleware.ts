import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import logger from '@adonisjs/core/services/logger'

/**
 * Logs every HTTP request: method, path, status code, duration, and
 * user-agent. Uses pino's structured JSON so it integrates with the
 * existing LOG_LEVEL env-var and ships cleanly through Docker.
 *
 * Registered as a server-level middleware (server.use) so it runs on
 * every request, including those that never match a route.
 */
export default class HttpAccessLogMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const start = Date.now()
    const { request } = ctx

    try {
      await next()
    } finally {
      const { response } = ctx
      const ms = Date.now() - start

      logger.info({
        type: 'http',
        method: request.method(),
        url: request.url(true),
        status: response.getStatus(),
        ms,
        ua: request.header('user-agent') ?? '',
        origin: request.header('origin') ?? '',
        ip: request.ip(),
        reqId: request.id(),
      })
    }
  }
}
