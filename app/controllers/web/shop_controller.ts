import type { HttpContext } from '@adonisjs/core/http'
import ShopService from '#services/shop_service'
import OrderService from '#services/order_service'
import NotificationService from '#services/notification_service'
import RecommendationService from '#services/recommendation_service'
import AuditService from '#services/audit_service'
import { purchaseValidator } from '#validators/order'
import logger from '@adonisjs/core/services/logger'
import Product from '#models/product'
import PageView from '#models/page_view'

export default class ShopController {
  async index({ inertia, auth, request }: HttpContext) {
    const shopService = new ShopService()
    const user = auth.user!

    // Fire-and-forget page view tracking
    PageView.create({ userId: user.id, channel: 'web' }).catch((err) => {
      logger.error({ err }, 'Failed to record page view')
    })

    const rawCategory = request.input('category')
    const categoryId = rawCategory ? Number(rawCategory) : undefined
    const rawExcludeAllergens = request.input('exclude_allergens')
    const excludeAllergens =
      typeof rawExcludeAllergens === 'string'
        ? rawExcludeAllergens
            .split(',')
            .map((part) => Number(part.trim()))
            .filter((id) => Number.isInteger(id) && id > 0)
        : []

    const recommendationService = new RecommendationService()
    const [rawProducts, categories, recommendedIds] = await Promise.all([
      shopService.getProducts({
        showAll: user.showAllProducts,
        userId: user.id,
      }),
      shopService.getCategories(),
      recommendationService.getRecommendedIds(user.id),
    ])

    const recommendedRankMap = new Map(recommendedIds.map((id, i) => [id, i + 1]))
    const products = rawProducts.map((p) => ({
      ...p,
      isRecommended: recommendedRankMap.has(p.id),
      recommendationRank: recommendedRankMap.get(p.id) ?? 0,
    }))

    return inertia.render('shop/index', {
      products,
      categories,
      // Both live under `filters` — that is where the page reads them from, and it is
      // also what the partial reload on filter changes asks for.
      filters: { category: categoryId ?? '', excludeAllergens },
    })
  }

  /**
   * "Add to favourites" link from the purchase-confirmation email.
   *
   * A GET that writes to the database can be triggered cross-site (an <img> tag suffices),
   * so the link is signed: the email carries a signature bound to this product and user,
   * and anything without a valid one is refused. It has to stay a GET — it is clicked from
   * a mail client, which cannot POST.
   */
  async addFavorite({ params, request, auth, response, session, i18n }: HttpContext) {
    if (!request.hasValidSignature('add-favorite')) {
      session.flash('alert', { type: 'danger', message: i18n.t('messages.action_failed') })
      return response.redirect('/shop')
    }

    const user = auth.user!
    const productId = Number(params.productId)
    const product = Number.isInteger(productId) ? await Product.find(productId) : null

    if (!product) {
      session.flash('alert', { type: 'danger', message: i18n.t('messages.not_found') })
      return response.redirect('/shop')
    }

    const existing = await user
      .related('favoriteProducts')
      .query()
      .where('products.id', productId)
      .first()

    if (existing) {
      session.flash('alert', { type: 'info', message: i18n.t('messages.favorite_already_added') })
      return response.redirect('/shop')
    }

    await user.related('favoriteProducts').attach([productId])
    await AuditService.log(user.id, 'favorite.added', 'product', productId, null, {
      name: product.displayName,
    })
    session.flash('alert', { type: 'success', message: i18n.t('messages.favorite_added') })

    return response.redirect('/shop')
  }

  async purchase({ request, auth, response, session, i18n }: HttpContext) {
    const { deliveryId } = await request.validateUsing(purchaseValidator)
    const orderService = new OrderService()

    try {
      const order = await orderService.purchase(auth.user!.id, deliveryId, 'web')
      session.flash('alert', { type: 'success', message: i18n.t('messages.purchase_success') })

      // Send email notification (fire-and-forget)
      const notificationService = new NotificationService()
      notificationService.sendPurchaseConfirmation(order).catch((err) => {
        logger.error({ err }, 'Failed to send purchase confirmation email')
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'OUT_OF_STOCK') {
        session.flash('alert', {
          type: 'danger',
          message: i18n.t('messages.purchase_out_of_stock'),
        })
      } else {
        session.flash('alert', { type: 'danger', message: i18n.t('messages.purchase_failed') })
      }
    }

    return response.redirect('/shop')
  }
}
