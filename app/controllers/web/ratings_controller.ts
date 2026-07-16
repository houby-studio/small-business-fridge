import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import ProductRatingService from '#services/product_rating_service'
import { createOrUpdateRatingValidator } from '#validators/rating'
import { isDomainError } from '#services/domain_error'
import ProductRating from '#models/product_rating'
import Product from '#models/product'
import type { RatingVisibility } from '#models/product_rating'
import type User from '#models/user'

/** Suppliers and admins see all ratings (they act on the feedback). */
function viewerCanSeePrivate(user: User): boolean {
  return user.role === 'admin' || user.role === 'supplier'
}

/**
 * Single source of truth for whether the public rating feed is enabled.
 * Backed by the RATINGS_PUBLIC_FEED_ENABLED env variable via config/ratings.ts.
 */
function isPublicFeedEnabled(): boolean {
  return app.config.get<boolean>('ratings.publicFeedEnabled', false)
}

export default class RatingsController {
  /**
   * GET /ratings — feed page with the "rate your recent purchases" section.
   */
  async feed({ inertia, request, auth }: HttpContext) {
    const user = auth.user!
    const canSeePrivate = viewerCanSeePrivate(user)
    const publicFeedEnabled = isPublicFeedEnabled()

    const page = Number(request.input('page', 1)) || 1
    const productIdRaw = request.input('productId')
    const visibilityRaw = request.input('visibility') as string | undefined
    const onlyMineRaw = request.input('onlyMine') as string | undefined
    const sortBy = request.input('sortBy', 'createdAt') as string
    const sortOrder = request.input('sortOrder', 'desc') === 'asc' ? 'asc' : 'desc'

    const filters = {
      productId: productIdRaw ? Number(productIdRaw) : undefined,
      // The visibility filter only applies while the public feed is on. With it
      // off the public/private split is hidden in the UI, so ignore the param
      // too — even a hand-crafted ?visibility query must not take effect.
      visibility:
        canSeePrivate &&
        publicFeedEnabled &&
        (visibilityRaw === 'public' || visibilityRaw === 'private')
          ? (visibilityRaw as RatingVisibility)
          : undefined,
      onlyMine: onlyMineRaw === 'true' || onlyMineRaw === '1',
    }

    const paginator = await ProductRatingService.listFeed({
      viewerUserId: user.id,
      viewerCanSeePrivate: canSeePrivate,
      publicFeedEnabled,
      page,
      perPage: 20,
      filters,
      sortBy,
      sortOrder,
    })

    const products = await Product.query().select('id', 'displayName').orderBy('displayName', 'asc')
    const unrated = await ProductRatingService.getUnratedProductsForUser(user.id)

    const data = paginator.all().map((rating) => ({
      id: rating.id,
      stars: rating.stars,
      comment: rating.comment,
      visibility: rating.visibility,
      createdAt: rating.createdAt.toISO(),
      updatedAt: rating.updatedAt.toISO(),
      isEdited: rating.updatedAt.toMillis() - rating.createdAt.toMillis() > 1000,
      user: rating.user ? { id: rating.user.id, displayName: rating.user.displayName } : null,
      product: rating.product
        ? { id: rating.product.id, displayName: rating.product.displayName }
        : null,
      upvoteCount: rating.upvotes ? rating.upvotes.length : 0,
      hasUpvoted: rating.upvotes ? rating.upvotes.some((u) => u.userId === user.id) : false,
      canEdit: rating.userId === user.id,
      canDelete: rating.userId === user.id || user.role === 'admin',
      // A customer can only upvote when the public feed is on. Suppliers/admins
      // (canSeePrivate) keep the ability regardless of the feed flag.
      canUpvote: rating.userId !== user.id && (publicFeedEnabled || canSeePrivate),
    }))

    return inertia.render('ratings/feed', {
      ratings: { data, meta: paginator.getMeta() },
      filters: {
        productId: filters.productId ?? '',
        visibility: filters.visibility ?? '',
        onlyMine: filters.onlyMine,
        sortBy,
        sortOrder,
      },
      products: products.map((p) => ({ id: p.id, displayName: p.displayName })),
      unrated,
      canSeePrivate,
      publicFeedEnabled,
    })
  }

  /**
   * Resolve the visibility actually persisted for a rating. With the public feed
   * disabled, a customer can never store a `public` rating — it is forced to
   * `private` regardless of the submitted payload. Suppliers/admins keep full
   * control, and any value is honoured while the feed is enabled.
   */
  private resolveVisibility(
    requested: RatingVisibility,
    user: HttpContext['auth']['user']
  ): RatingVisibility {
    if (isPublicFeedEnabled()) return requested
    if (viewerCanSeePrivate(user!)) return requested
    return 'private'
  }

  async store({ request, response, session, i18n, auth }: HttpContext) {
    const payload = await request.validateUsing(createOrUpdateRatingValidator)
    const productIdRaw = payload.productId ?? Number(request.input('productId'))
    const productId = Number(productIdRaw)
    if (!productId) {
      session.flash('alert', { type: 'danger', message: i18n.t('rating.flash_invalid') })
      return response.redirect('back')
    }

    const visibility = this.resolveVisibility(payload.visibility, auth.user)

    try {
      await ProductRatingService.upsertRating({
        userId: auth.user!.id,
        productId,
        stars: payload.stars,
        comment: payload.comment ?? null,
        visibility,
      })
      session.flash('alert', { type: 'success', message: i18n.t('rating.flash_saved') })
      return response.redirect('back')
    } catch (error: unknown) {
      if (isDomainError(error, 'RATING_NOT_ORDERED')) {
        session.flash('alert', { type: 'danger', message: i18n.t('rating.flash_not_ordered') })
        return response.status(403).redirect('back')
      }
      if (isDomainError(error, 'RATING_WINDOW_CLOSED')) {
        session.flash('alert', { type: 'danger', message: i18n.t('rating.flash_window_closed') })
        return response.status(403).redirect('back')
      }
      throw error
    }
  }

  async update({ params, request, response, session, i18n, auth }: HttpContext) {
    const payload = await request.validateUsing(createOrUpdateRatingValidator)
    const rating = await ProductRating.find(Number(params.id))
    if (!rating) {
      session.flash('alert', { type: 'danger', message: i18n.t('rating.flash_not_found') })
      return response.status(404).redirect('back')
    }
    if (rating.userId !== auth.user!.id) {
      session.flash('alert', { type: 'danger', message: i18n.t('rating.flash_forbidden') })
      return response.status(403).redirect('back')
    }

    const visibility = this.resolveVisibility(payload.visibility, auth.user)

    try {
      await ProductRatingService.upsertRating({
        userId: auth.user!.id,
        productId: rating.productId,
        stars: payload.stars,
        comment: payload.comment ?? null,
        visibility,
      })
      session.flash('alert', { type: 'success', message: i18n.t('rating.flash_saved') })
      return response.redirect('back')
    } catch (error: unknown) {
      if (isDomainError(error, 'RATING_NOT_ORDERED')) {
        session.flash('alert', { type: 'danger', message: i18n.t('rating.flash_not_ordered') })
        return response.status(403).redirect('back')
      }
      if (isDomainError(error, 'RATING_WINDOW_CLOSED')) {
        session.flash('alert', { type: 'danger', message: i18n.t('rating.flash_window_closed') })
        return response.status(403).redirect('back')
      }
      throw error
    }
  }

  async destroy({ params, response, session, i18n, auth }: HttpContext) {
    const user = auth.user!
    const isAdmin = user.role === 'admin'

    try {
      await ProductRatingService.deleteRating(Number(params.id), user.id, isAdmin)
      session.flash('alert', { type: 'success', message: i18n.t('rating.flash_deleted') })
      return response.redirect('back')
    } catch (error: unknown) {
      if (isDomainError(error, 'RATING_FORBIDDEN')) {
        session.flash('alert', { type: 'danger', message: i18n.t('rating.flash_forbidden') })
        return response.status(403).redirect('back')
      }
      if (isDomainError(error, 'RATING_NOT_FOUND')) {
        session.flash('alert', { type: 'danger', message: i18n.t('rating.flash_not_found') })
        return response.status(404).redirect('back')
      }
      throw error
    }
  }

  async toggleUpvote({ params, response, session, i18n, auth }: HttpContext) {
    const user = auth.user!
    const canSeePrivate = viewerCanSeePrivate(user)

    try {
      await ProductRatingService.toggleUpvote(Number(params.id), user.id, {
        publicFeedEnabled: isPublicFeedEnabled(),
        viewerCanSeePrivate: canSeePrivate,
      })
      return response.redirect('back')
    } catch (error: unknown) {
      if (isDomainError(error, 'RATING_SELF_UPVOTE')) {
        session.flash('alert', { type: 'danger', message: i18n.t('rating.flash_self_upvote') })
        return response.status(403).redirect('back')
      }
      if (isDomainError(error, 'RATING_UPVOTE_DISABLED')) {
        session.flash('alert', { type: 'danger', message: i18n.t('rating.flash_forbidden') })
        return response.status(403).redirect('back')
      }
      if (isDomainError(error, 'RATING_NOT_FOUND')) {
        session.flash('alert', { type: 'danger', message: i18n.t('rating.flash_not_found') })
        return response.status(404).redirect('back')
      }
      throw error
    }
  }
}
