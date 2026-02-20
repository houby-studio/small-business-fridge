import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import User from '#models/user'
import Recommendation from '#models/recommendation'

export default class RecommendationService {
  /**
   * Compute statistical scores for a single user.
   * Returns product IDs sorted by score descending, filtered to in-stock only.
   */
  async computeForUser(userId: number): Promise<Array<{ productId: number; score: number }>> {
    const rows = await db.rawQuery<{ rows: Array<{ product_id: number; score: number }> }>(
      `
      WITH
      current_ctx AS (
        SELECT
          EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Europe/Prague') AS h,
          EXTRACT(DOW  FROM NOW() AT TIME ZONE 'Europe/Prague') AS dow
      ),
      user_history AS (
        SELECT
          d.product_id,
          COUNT(*) AS total_buys,
          COUNT(*) FILTER (
            WHERE ABS(EXTRACT(HOUR FROM o.created_at AT TIME ZONE 'Europe/Prague')
                      - (SELECT h FROM current_ctx)) <= 1
              AND EXTRACT(DOW FROM o.created_at AT TIME ZONE 'Europe/Prague')
                    = (SELECT dow FROM current_ctx)
          ) AS context_buys,
          MAX(o.created_at) AS last_bought
        FROM orders o
        JOIN deliveries d ON d.id = o.delivery_id
        WHERE o.buyer_id = ?
        GROUP BY d.product_id
      ),
      max_buys AS (SELECT GREATEST(MAX(total_buys), 1) AS val FROM user_history),
      in_stock AS (
        SELECT DISTINCT product_id FROM deliveries WHERE amount_left > 0
      )
      SELECT
        uh.product_id,
        0.40 * (uh.context_buys::float / GREATEST(uh.total_buys, 1))
      + 0.35 * (uh.total_buys::float / (SELECT val FROM max_buys))
      + 0.25 * EXP(-EXTRACT(EPOCH FROM (NOW() - uh.last_bought)) / (14.0 * 86400))
          AS score
      FROM user_history uh
      JOIN in_stock isp ON isp.product_id = uh.product_id
      ORDER BY score DESC
      LIMIT 10
      `,
      [userId]
    )

    return rows.rows.map((r) => ({ productId: r.product_id, score: Number(r.score) }))
  }

  /**
   * Refresh statistical recommendations for all active, non-disabled users.
   */
  async refreshAll(): Promise<void> {
    const users = await User.query().where('isDisabled', false).select('id')

    let refreshed = 0
    for (const user of users) {
      const scored = await this.computeForUser(user.id)

      await Recommendation.query().where('userId', user.id).where('model', 'statistical').delete()

      if (scored.length > 0) {
        const now = DateTime.now()
        await Recommendation.createMany(
          scored.map((s, idx) => ({
            userId: user.id,
            productId: s.productId,
            score: s.score,
            model: 'statistical' as const,
            rank: idx + 1,
            generatedAt: now,
          }))
        )
        refreshed++
      }
    }

    logger.info({ users: users.length, refreshed }, 'Statistical recommendations refreshed')
  }

  /**
   * Return the top-N recommended product IDs for a user (ordered by rank).
   * Uses precomputed rows if available, falls back to live computation.
   * Stock filtering is NOT done here — callers merge against the product list
   * from ShopService, which already excludes out-of-stock items.
   */
  async getRecommendedIds(userId: number, limit: number = 4): Promise<number[]> {
    const precomputed = await Recommendation.query()
      .where('userId', userId)
      .where('model', 'statistical')
      .orderBy('rank', 'asc')
      .limit(limit)
      .select('productId')

    if (precomputed.length > 0) {
      return precomputed.map((r) => r.productId)
    }

    // First run before scheduler — compute live
    const scored = await this.computeForUser(userId)
    return scored.slice(0, limit).map((s) => s.productId)
  }
}
