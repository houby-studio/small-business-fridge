import type { HttpContext } from '@adonisjs/core/http'
import ShopService from '#services/shop_service'
import OrderService from '#services/order_service'
import NotificationService from '#services/notification_service'
import RecommendationService from '#services/recommendation_service'
import { purchaseValidator } from '#validators/order'
import logger from '@adonisjs/core/services/logger'
import Product from '#models/product'
import PageView from '#models/page_view'

export default class ShopController {
  async index({ inertia, auth, request, response, session, i18n }: HttpContext) {
    const shopService = new ShopService()
    const user = auth.user!

    // Handle ?add_favorite=X param (used in purchase confirmation email links)
    const addFavoriteRaw = request.input('add_favorite')
    if (addFavoriteRaw) {
      const productId = Number(addFavoriteRaw)
      if (!Number.isNaN(productId) && productId > 0) {
        const product = await Product.find(productId)
        if (product) {
          const existing = await user
            .related('favoriteProducts')
            .query()
            .where('products.id', productId)
            .first()
          if (!existing) {
            await user.related('favoriteProducts').attach([productId])
            session.flash('alert', { type: 'success', message: i18n.t('messages.favorite_added') })
          } else {
            session.flash('alert', {
              type: 'info',
              message: i18n.t('messages.favorite_already_added'),
            })
          }
        }
      }
      return response.redirect('/shop')
    }

    // Fire-and-forget page view tracking
    PageView.create({ userId: user.id, channel: 'web' }).catch((err) => {
      logger.error({ err }, 'Failed to record page view')
    })

    const rawCategory = request.input('category')
    const categoryId = rawCategory ? Number(rawCategory) : undefined

    const recommendationService = new RecommendationService()
    const [products, categories, recommendations] = await Promise.all([
      shopService.getProducts({
        showAll: user.showAllProducts,
        userId: user.id,
      }),
      shopService.getCategories(),
      recommendationService.getForUser(user.id),
    ])

    return inertia.render('shop/index', {
      products,
      categories,
      filters: { category: categoryId ?? null },
      recommendations,
    })
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
