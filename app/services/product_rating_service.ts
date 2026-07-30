import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import ProductRating from '#models/product_rating'
import type { RatingVisibility } from '#models/product_rating'
import ProductRatingUpvote from '#models/product_rating_upvote'
import Order from '#models/order'
import { DomainError } from '#services/domain_error'
import AuditService from '#services/audit_service'

const RATING_WINDOW_DAYS = 14

const SORT_FIELD_WHITELIST = ['createdAt', 'stars'] as const
type SortField = (typeof SORT_FIELD_WHITELIST)[number]

export type RatingFeedFilters = {
  productId?: number
  visibility?: RatingVisibility
  onlyMine?: boolean
}

export type ListFeedParams = {
  viewerUserId: number
  viewerCanSeePrivate: boolean
  /**
   * Whether the public feed is enabled for customers. When `false` (default),
   * a viewer without the privilege only ever sees their own ratings. Has no
   * effect on viewers with `viewerCanSeePrivate=true` (they always see all).
   */
  publicFeedEnabled?: boolean
  page?: number
  perPage?: number
  filters?: RatingFeedFilters
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export type UnratedProductEntry = {
  productId: number
  productName: string
  purchasedAt: string
}

export type AggregateResult = {
  average: number | null
  count: number
}

export default class ProductRatingService {
  /**
   * Find the most recent purchase timestamp of the product by the user.
   * Returns ISO date string or null when the user never bought it.
   */
  static async findLatestPurchaseDate(userId: number, productId: number): Promise<string | null> {
    const row = await db
      .from('orders')
      .innerJoin('deliveries', 'deliveries.id', 'orders.delivery_id')
      .where('deliveries.product_id', productId)
      .where('orders.buyer_id', userId)
      .max('orders.created_at as latest')
      .first()

    if (!row || !row.latest) return null
    if (row.latest instanceof Date) {
      return DateTime.fromJSDate(row.latest).toISODate()!
    }
    return DateTime.fromISO(String(row.latest)).toISODate() ?? String(row.latest)
  }

  /**
   * Create or update a rating. Enforces:
   *  - the user must have bought the product
   *  - the latest such purchase must be within the 14-day window
   *
   * Throws DomainError('RATING_NOT_ORDERED') or DomainError('RATING_WINDOW_CLOSED').
   */
  static async upsertRating(input: {
    userId: number
    productId: number
    stars: number
    comment: string | null
    visibility: RatingVisibility
  }) {
    const { userId, productId, stars, comment, visibility } = input

    const latest = await this.findLatestPurchaseDate(userId, productId)
    if (!latest) {
      throw new DomainError('RATING_NOT_ORDERED')
    }

    const today = DateTime.utc().startOf('day')
    const latestDt = DateTime.fromISO(latest).startOf('day')
    const ageDays = Math.floor(today.diff(latestDt, 'days').days)
    if (ageDays > RATING_WINDOW_DAYS - 1) {
      throw new DomainError('RATING_WINDOW_CLOSED')
    }

    const existing = await ProductRating.query()
      .where('userId', userId)
      .where('productId', productId)
      .first()

    if (existing) {
      // Capture previous values to audit log BEFORE saving the new ones.
      await AuditService.log(
        userId,
        'product_rating.updated',
        'product_rating',
        existing.id,
        userId,
        {
          previous: {
            stars: existing.stars,
            comment: existing.comment,
            visibility: existing.visibility,
          },
          next: {
            stars,
            comment: comment ?? null,
            visibility,
          },
        }
      )
      existing.stars = stars
      existing.comment = comment ?? null
      existing.visibility = visibility
      await existing.save()
      return existing
    }

    const created = await ProductRating.create({
      userId,
      productId,
      stars,
      comment: comment ?? null,
      visibility,
    })
    await AuditService.log(userId, 'product_rating.created', 'product_rating', created.id, userId, {
      stars,
      visibility,
    })
    return created
  }

  /**
   * Delete a rating. Allowed for the owner or an admin.
   * Throws DomainError('RATING_NOT_FOUND') or DomainError('RATING_FORBIDDEN').
   */
  static async deleteRating(ratingId: number, viewerUserId: number, viewerIsAdmin: boolean) {
    const rating = await ProductRating.find(ratingId)
    if (!rating) {
      throw new DomainError('RATING_NOT_FOUND')
    }
    if (rating.userId !== viewerUserId && !viewerIsAdmin) {
      throw new DomainError('RATING_FORBIDDEN')
    }
    await rating.delete()
    await AuditService.log(
      viewerUserId,
      'product_rating.deleted',
      'product_rating',
      ratingId,
      rating.userId,
      null
    )
  }

  /**
   * Paginated feed.
   *
   * Visibility rules:
   *  - viewers with `viewerCanSeePrivate=true` (supplier or admin) see everything.
   *  - viewers without that privilege:
   *      - public feed ENABLED: see public ratings + their own ratings.
   *      - public feed DISABLED (default): see ONLY their own ratings; ratings of
   *        other users (including ones marked `public`) stay hidden in the DB.
   */
  static async listFeed(params: ListFeedParams) {
    const page = Math.max(1, params.page ?? 1)
    const perPage = Math.max(1, Math.min(100, params.perPage ?? 20))

    const sortBy: SortField = SORT_FIELD_WHITELIST.includes((params.sortBy ?? '') as SortField)
      ? (params.sortBy as SortField)
      : 'createdAt'
    const sortColumn = sortBy === 'createdAt' ? 'created_at' : 'stars'
    const sortOrder = params.sortOrder === 'asc' ? 'asc' : 'desc'

    const query = ProductRating.query()
      .preload('user')
      .preload('product')
      .preload('upvotes')
      .orderBy(sortColumn, sortOrder)

    if (params.filters?.productId) {
      query.where('productId', params.filters.productId)
    }

    if (params.filters?.onlyMine) {
      query.where('userId', params.viewerUserId)
    }

    if (params.viewerCanSeePrivate) {
      if (params.filters?.visibility) {
        query.where('visibility', params.filters.visibility)
      }
    } else if (params.publicFeedEnabled) {
      query.where((q) => {
        q.where('visibility', 'public').orWhere('userId', params.viewerUserId)
      })
    } else {
      // Public feed disabled: a customer only ever sees their own ratings.
      query.where('userId', params.viewerUserId)
    }

    return query.paginate(page, perPage)
  }

  /**
   * Aggregate average + count for a product.
   * Returns { average: null, count: 0 } when there are no ratings.
   */
  static async getProductAggregate(productId: number): Promise<AggregateResult> {
    const row = await db
      .from('product_ratings')
      .where('product_id', productId)
      .select(db.raw('AVG(stars)::float as avg'))
      .count('* as cnt')
      .first()

    const count = Number(row?.cnt ?? 0)
    if (count === 0) {
      return { average: null, count: 0 }
    }
    const average = row?.avg !== null && row?.avg !== undefined ? Number(row.avg) : null
    return { average, count }
  }

  /**
   * Aggregate for many products at once.
   */
  static async getProductAggregates(
    productIds: number[]
  ): Promise<Record<number, AggregateResult>> {
    if (productIds.length === 0) return {}
    const rows = await db
      .from('product_ratings')
      .whereIn('product_id', productIds)
      .groupBy('product_id')
      .select('product_id')
      .select(db.raw('AVG(stars)::float as avg'))
      .count('* as cnt')

    const out: Record<number, AggregateResult> = {}
    for (const id of productIds) {
      out[id] = { average: null, count: 0 }
    }
    for (const row of rows) {
      const id = Number(row.product_id)
      const cnt = Number(row.cnt ?? 0)
      out[id] = {
        average: cnt > 0 && row.avg !== null && row.avg !== undefined ? Number(row.avg) : null,
        count: cnt,
      }
    }
    return out
  }

  /**
   * Returns products the user bought within the last N days that they have NOT
   * yet rated. Deduplicated by productId — one entry per product regardless of
   * how many units or separate purchases.
   */
  static async getUnratedProductsForUser(
    userId: number,
    days: number = RATING_WINDOW_DAYS
  ): Promise<UnratedProductEntry[]> {
    const earliest = DateTime.utc()
      .startOf('day')
      .minus({ days: days - 1 })
      .toJSDate()

    const orders = await Order.query()
      .where('buyerId', userId)
      .where('createdAt', '>=', earliest)
      .preload('delivery', (q) => q.preload('product'))
      .orderBy('createdAt', 'desc')

    if (orders.length === 0) return []

    const productIds = [
      ...new Set(orders.map((o) => o.delivery?.productId).filter((id) => id !== undefined)),
    ] as number[]
    const ratedRows = await ProductRating.query()
      .where('userId', userId)
      .whereIn('productId', productIds)
      .select('productId')
    const ratedProductIds = new Set(ratedRows.map((r) => r.productId))

    const seen = new Set<number>()
    const out: UnratedProductEntry[] = []
    for (const order of orders) {
      const productId = order.delivery?.productId
      if (!productId) continue
      if (ratedProductIds.has(productId)) continue
      if (seen.has(productId)) continue
      seen.add(productId)
      out.push({
        productId,
        productName: order.delivery?.product?.displayName ?? '',
        purchasedAt: order.createdAt?.toISODate() ?? '',
      })
    }
    return out
  }

  static async getUnratedProductsCount(userId: number, days: number = RATING_WINDOW_DAYS) {
    const list = await this.getUnratedProductsForUser(userId, days)
    return list.length
  }

  /**
   * Toggle an upvote on a rating. The author cannot upvote their own rating.
   * Returns the new total upvote count.
   *
   * When the public feed is disabled (`publicFeedEnabled=false`), a non-privileged
   * viewer (customer) has no access to other users' ratings, so upvoting someone
   * else's rating is rejected with DomainError('RATING_UPVOTE_DISABLED').
   *
   * Throws DomainError('RATING_NOT_FOUND'), DomainError('RATING_SELF_UPVOTE')
   * or DomainError('RATING_UPVOTE_DISABLED').
   */
  static async toggleUpvote(
    ratingId: number,
    userId: number,
    opts: { publicFeedEnabled?: boolean; viewerCanSeePrivate?: boolean } = {}
  ): Promise<number> {
    const rating = await ProductRating.find(ratingId)
    if (!rating) {
      throw new DomainError('RATING_NOT_FOUND')
    }
    if (rating.userId === userId) {
      throw new DomainError('RATING_SELF_UPVOTE')
    }
    // With the public feed disabled, a customer cannot see (and therefore cannot
    // upvote) other users' ratings. Suppliers and admins keep full access.
    if (!opts.publicFeedEnabled && !opts.viewerCanSeePrivate) {
      throw new DomainError('RATING_UPVOTE_DISABLED')
    }

    const existing = await ProductRatingUpvote.query()
      .where('productRatingId', ratingId)
      .where('userId', userId)
      .first()

    if (existing) {
      await existing.delete()
    } else {
      try {
        await ProductRatingUpvote.create({ productRatingId: ratingId, userId })
      } catch (error: unknown) {
        // Race / unique-violation safe-guard
        if ((error as { code?: string }).code !== '23505') throw error
      }
    }

    return this.getUpvoteCount(ratingId)
  }

  static async getUpvoteCount(ratingId: number): Promise<number> {
    const row = await db
      .from('product_rating_upvotes')
      .where('product_rating_id', ratingId)
      .count('* as cnt')
      .first()
    return Number(row?.cnt ?? 0)
  }

  static get RATING_WINDOW_DAYS() {
    return RATING_WINDOW_DAYS
  }
}
