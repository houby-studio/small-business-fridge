import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import ShopService from '#services/shop_service'
import OrderService from '#services/order_service'
import NotificationService from '#services/notification_service'
import RecommendationService from '#services/recommendation_service'
import logger from '@adonisjs/core/services/logger'
import KioskSession from '#models/kiosk_session'

export default class KioskController {
  /**
   * Kiosk split-screen — left: keypad, right: featured or personalized products.
   * GET /kiosk                → idle state with featured products
   * GET /kiosk?keypadId=XXXX  → identified state with personalized picks
   */
  async index({ inertia, request, i18n }: HttpContext) {
    const keypadId = request.input('keypadId')
    const shopService = new ShopService()

    // Always load featured products (used in idle state)
    const featuredProducts = await shopService.getFeaturedProducts(8)

    if (!keypadId) {
      return inertia.render('kiosk/index', {
        panelState: 'idle',
        featuredProducts,
        personalizedProducts: [],
        customer: null,
        error: null,
      })
    }

    const customer = await User.query()
      .where('keypadId', keypadId)
      .where('isDisabled', false)
      .first()

    if (!customer) {
      return inertia.render('kiosk/index', {
        panelState: 'idle',
        featuredProducts,
        personalizedProducts: [],
        customer: null,
        error: i18n.t('messages.kiosk_customer_not_found'),
      })
    }

    // Fire-and-forget kiosk session tracking
    KioskSession.create({ userId: customer.id }).catch((err) => {
      logger.error({ err }, 'Failed to record kiosk session')
    })

    const recommendationService = new RecommendationService()
    const [rawProducts, recommendedIds] = await Promise.all([
      shopService.getProducts({ showAll: false, userId: customer.id }),
      recommendationService.getRecommendedIds(customer.id, 8),
    ])

    const recommendedRankMap = new Map(recommendedIds.map((id, i) => [id, i + 1]))
    const personalizedProducts = rawProducts
      .map((p) => ({
        ...p,
        isRecommended: recommendedRankMap.has(p.id),
        recommendationRank: recommendedRankMap.get(p.id) ?? 0,
      }))
      .sort((a, b) => {
        if (a.isRecommended !== b.isRecommended) return a.isRecommended ? -1 : 1
        if (a.isRecommended && b.isRecommended) return a.recommendationRank - b.recommendationRank
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1
        return a.displayName.localeCompare(b.displayName, 'cs')
      })
      .slice(0, 8)

    return inertia.render('kiosk/index', {
      panelState: 'identified',
      featuredProducts,
      personalizedProducts,
      customer: {
        id: customer.id,
        displayName: customer.displayName,
        keypadId: customer.keypadId,
      },
      error: null,
    })
  }

  /**
   * Kiosk shop — shows full product grid for a specific user (identified by keypad ID).
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
      shopService.getProducts({ showAll: false, userId: customer.id }),
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
   * Kiosk purchase — buy a product for a specific customer.
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

      // Send email notification (fire-and-forget)
      const notificationService = new NotificationService()
      notificationService.sendPurchaseConfirmation(order).catch((err) => {
        logger.error({ err }, 'Failed to send purchase confirmation email')
      })

      // Redirect back to kiosk index for this customer
      const customer = await User.find(customerId)
      return response.redirect(`/kiosk?keypadId=${customer?.keypadId ?? ''}&success=1`)
    } catch {
      const customer = await User.find(customerId)
      return response.redirect(`/kiosk?keypadId=${customer?.keypadId ?? ''}&error=out_of_stock`)
    }
  }
}
