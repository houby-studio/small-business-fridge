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
  async computeForUser(
    userId: number,
    excludedAllergenIds: number[] = []
  ): Promise<Array<{ productId: number; score: number }>> {
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
      WHERE NOT EXISTS (
        SELECT 1
        FROM product_allergen pa
        WHERE pa.product_id = uh.product_id
          AND pa.allergen_id = ANY(COALESCE(?::int[], ARRAY[]::int[]))
      )
      ORDER BY score DESC
      LIMIT 10
      `,
      [userId, excludedAllergenIds]
    )

    return rows.rows.map((r) => ({
      productId: r.product_id,
      // Numerical safety: clamp to [0, 1] to avoid tiny FP rounding issues
      score: Math.min(1, Math.max(0, Number(r.score))),
    }))
  }

  /**
   * Refresh statistical recommendations for all active, non-disabled users.
   */
  async refreshAll(): Promise<void> {
    const users = await User.query().where('isDisabled', false).select('id')
    const userIds = users.map((user) => user.id)
    const excludedRows =
      userIds.length > 0
        ? await db
            .from('user_excluded_allergen')
            .select('user_id', 'allergen_id')
            .whereIn('user_id', userIds)
        : []

    const excludedByUserId = new Map<number, number[]>()
    for (const row of excludedRows) {
      const userId = Number(row.user_id)
      const allergenId = Number(row.allergen_id)
      const existing = excludedByUserId.get(userId) ?? []
      existing.push(allergenId)
      excludedByUserId.set(userId, existing)
    }

    let refreshed = 0
    for (const user of users) {
      const scored = await this.computeForUser(user.id, excludedByUserId.get(user.id) ?? [])

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
   * Keeps only products that are currently in stock before applying the limit.
   */
  async getRecommendedIds(userId: number, limit: number = 4): Promise<number[]> {
    const excludedRows = await db
      .from('user_excluded_allergen')
      .where('user_id', userId)
      .select('allergen_id')
    const excludedAllergenIds = excludedRows.map((row) => Number(row.allergen_id))

    const precomputed = await Recommendation.query()
      .where('userId', userId)
      .where('model', 'statistical')
      .whereExists((q) => {
        q.from('deliveries')
          .select(db.raw('1'))
          .whereColumn('deliveries.product_id', 'recommendations.product_id')
          .where('deliveries.amount_left', '>', 0)
      })
      .if(excludedAllergenIds.length > 0, (q) => {
        q.whereNotExists((sub) => {
          sub
            .from('product_allergen')
            .select(db.raw('1'))
            .whereColumn('product_allergen.product_id', 'recommendations.product_id')
            .whereIn('product_allergen.allergen_id', excludedAllergenIds)
        })
      })
      .orderBy('rank', 'asc')
      .limit(limit)
      .select('productId')

    if (precomputed.length > 0) {
      return precomputed.map((r) => r.productId)
    }

    // First run before scheduler — compute live
    const scored = await this.computeForUser(userId, excludedAllergenIds)
    return scored.slice(0, limit).map((s) => s.productId)
  }
}
