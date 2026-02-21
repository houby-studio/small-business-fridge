import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class HealthController {
  /**
   * @summary Health check
   * @description Returns service health status including database connectivity and uptime.
   * @tag Health
   * @responseBody 200 - {"status": "ok", "timestamp": "2024-01-01T12:00:00.000Z", "uptime": 3600, "checks": {"database": {"status": "ok", "latency": 2}}}
   * @responseBody 503 - {"status": "degraded", "timestamp": "2024-01-01T12:00:00.000Z", "uptime": 3600, "checks": {"database": {"status": "error", "latency": 100, "error": "connection refused"}}}
   * @noAuth true
   */
  async index({ response }: HttpContext) {
    const checks: Record<string, { status: string; latency?: number; error?: string }> = {}

    // Database check
    const dbStart = Date.now()
    try {
      await db.rawQuery('SELECT 1')
      checks.database = { status: 'ok', latency: Date.now() - dbStart }
    } catch (err) {
      checks.database = {
        status: 'error',
        latency: Date.now() - dbStart,
        error: (err as Error).message,
      }
    }

    const allOk = Object.values(checks).every((c) => c.status === 'ok')

    return response.status(allOk ? 200 : 503).json({
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    })
  }
}
