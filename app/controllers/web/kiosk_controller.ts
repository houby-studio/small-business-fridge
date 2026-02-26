import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import ShopService from '#services/shop_service'
import OrderService, { FifoViolationError, OutOfStockError } from '#services/order_service'
import NotificationService from '#services/notification_service'
import RecommendationService from '#services/recommendation_service'
import MusicService from '#services/music_service'
import logger from '@adonisjs/core/services/logger'
import KioskSession from '#models/kiosk_session'
import db from '@adonisjs/lucid/services/db'
import { purchaseBasketValidator } from '#validators/order'
import env from '#start/env'

export default class KioskController {
  /**
   * Kiosk split-screen index — loads featured products (slideshow) and all products (catalog).
   * State management (idle vs identified) is handled entirely client-side.
   */
  async index({ inertia }: HttpContext) {
    const shopService = new ShopService()
    const [featuredProducts, allProducts] = await Promise.all([
      shopService.getKioskFeaturedProducts(8),
      shopService.getKioskProducts({ showAll: false }),
    ])

    return inertia.render('kiosk/index', { featuredProducts, allProducts })
  }

  /**
   * JSON endpoint — identify a customer by keypadId.
   * Returns customer info + favoriteIds + recommendedIds for client-side personalization.
   */
  async identify({ request, response, i18n }: HttpContext) {
    const keypadId = request.input('keypadId')
    const normalizedKeypadId = String(keypadId ?? '').trim()

    if (!normalizedKeypadId) {
      return response.status(400).json({ error: 'missing_keypad_id' })
    }

    const kioskLogoutCode = env.get('KIOSK_LOGOUT_CODE', '000000')
    if (normalizedKeypadId === kioskLogoutCode) {
      return response.json({ action: 'logout' })
    }

    if (normalizedKeypadId === '666') {
      return response.json({
        action: 'easter_egg',
        message: i18n.t('kiosk.easter_egg_666'),
      })
    }

    const customer = await User.query()
      .where('keypadId', normalizedKeypadId)
      .where('isDisabled', false)
      .first()

    if (!customer) {
      return response.status(404).json({ error: i18n.t('messages.kiosk_customer_not_found') })
    }

    // Fire-and-forget kiosk session tracking
    KioskSession.create({ userId: customer.id }).catch((err) => {
      logger.error({ err }, 'Failed to record kiosk session')
    })

    const recommendationService = new RecommendationService()
    const musicService = new MusicService()
    const [favoriteRows, excludedAllergenRows, recommendedIds, musicTracks] = await Promise.all([
      db.from('user_favorites').where('user_id', customer.id).select('product_id'),
      db
        .from('user_excluded_allergen')
        .where('user_id', customer.id)
        .orderBy('allergen_id', 'asc')
        .select('allergen_id'),
      recommendationService.getRecommendedIds(customer.id, 8),
      musicService.getEligibleTracks(customer.id),
    ])

    return response.json({
      customer: {
        id: customer.id,
        displayName: customer.displayName,
        keypadId: customer.keypadId,
      },
      favoriteIds: favoriteRows.map((r: { product_id: number }) => r.product_id),
      recommendedIds,
      excludedAllergenIds: excludedAllergenRows.map((row: { allergen_id: number }) =>
        Number(row.allergen_id)
      ),
      musicTracks,
    })
  }

  /**
   * JSON endpoint — purchase an entire basket atomically.
   * All items succeed or the whole transaction rolls back.
   */
  async purchaseBasket({ request, response }: HttpContext) {
    const { customerId, items } = await request.validateUsing(purchaseBasketValidator)

    const orderService = new OrderService()

    try {
      const orders = await orderService.purchaseBasket(customerId, items, 'kiosk')

      const notificationService = new NotificationService()
      notificationService.sendBatchPurchaseConfirmation(orders, customerId).catch((err) => {
        logger.error({ err }, 'Failed to send batch purchase confirmation email')
      })

      return response.json({ ok: true, orderCount: orders.length })
    } catch (err: unknown) {
      if (err instanceof OutOfStockError) {
        return response.json({ ok: false, error: 'out_of_stock', deliveryId: err.deliveryId })
      }
      if (err instanceof FifoViolationError) {
        return response.json({ ok: false, error: 'fifo_violation', productId: err.productId })
      }
      logger.error({ err }, 'Basket purchase failed')
      return response.json({ ok: false, error: 'failed' })
    }
  }

  /**
   * Kiosk shop — full product grid fallback (still accessible via /kiosk/shop).
   */
  async shop({ inertia, request, i18n }: HttpContext) {
    const keypadId = request.input('keypadId')

    if (!keypadId) {
      return inertia.render('kiosk/shop', {
        customer: null,
        products: [],
        categories: [],
        error: i18n.t('messages.kiosk_enter_id'),
      })
    }

    const customer = await User.query()
      .where('keypadId', keypadId)
      .where('isDisabled', false)
      .first()

    if (!customer) {
      return inertia.render('kiosk/shop', {
        customer: null,
        products: [],
        categories: [],
        error: i18n.t('messages.kiosk_customer_not_found'),
      })
    }

    // Fire-and-forget kiosk session tracking
    KioskSession.create({ userId: customer.id }).catch((err) => {
      logger.error({ err }, 'Failed to record kiosk session')
    })

    const shopService = new ShopService()
    const recommendationService = new RecommendationService()
    const [rawProducts, categories, recommendedIds] = await Promise.all([
      shopService.getKioskProducts({ showAll: false, userId: customer.id }),
      shopService.getCategories(),
      recommendationService.getRecommendedIds(customer.id),
    ])

    const recommendedRankMap = new Map(recommendedIds.map((id, i) => [id, i + 1]))
    const products = rawProducts.map((p) => ({
      ...p,
      isRecommended: recommendedRankMap.has(p.id),
      recommendationRank: recommendedRankMap.get(p.id) ?? 0,
    }))

    return inertia.render('kiosk/shop', {
      customer: {
        id: customer.id,
        displayName: customer.displayName,
        keypadId: customer.keypadId,
      },
      products,
      categories,
      error: null,
    })
  }

  /**
   * Legacy single-item purchase — kept for /kiosk/shop page.
   */
  async purchase({ request, response }: HttpContext) {
    const customerId = request.input('customerId')
    const deliveryId = request.input('deliveryId')

    if (!customerId || !deliveryId) {
      return response.redirect('/kiosk')
    }

    const orderService = new OrderService()

    try {
      const order = await orderService.purchase(customerId, deliveryId, 'kiosk')

      const notificationService = new NotificationService()
      notificationService.sendPurchaseConfirmation(order).catch((err) => {
        logger.error({ err }, 'Failed to send purchase confirmation email')
      })

      const customer = await User.find(customerId)
      return response.redirect(`/kiosk/shop?keypadId=${customer?.keypadId ?? ''}&success=1`)
    } catch {
      const customer = await User.find(customerId)
      return response.redirect(
        `/kiosk/shop?keypadId=${customer?.keypadId ?? ''}&error=out_of_stock`
      )
    }
  }
}
