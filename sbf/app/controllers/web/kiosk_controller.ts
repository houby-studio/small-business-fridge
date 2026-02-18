import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import ShopService from '#services/shop_service'
import OrderService from '#services/order_service'
import NotificationService from '#services/notification_service'
import logger from '@adonisjs/core/services/logger'

export default class KioskController {
  /**
   * Kiosk keypad — users enter their keypad ID to identify themselves.
   */
  async index({ inertia }: HttpContext) {
    return inertia.render('kiosk/index')
  }

  /**
   * Kiosk shop — shows products for a specific user (identified by keypad ID).
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

    const shopService = new ShopService()
    const [products, categories] = await Promise.all([
      shopService.getProducts({ showAll: false, userId: customer.id }),
      shopService.getCategories(),
    ])

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
      const order = await orderService.purchase(customerId, deliveryId, 'keypad')

      // Send email notification (fire-and-forget)
      const notificationService = new NotificationService()
      notificationService.sendPurchaseConfirmation(order).catch((err) => {
        logger.error({ err }, 'Failed to send purchase confirmation email')
      })

      // Redirect back to kiosk shop for this customer
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
