import type { HttpContext } from '@adonisjs/core/http'
import ShopService from '#services/shop_service'
import OrderService from '#services/order_service'
import NotificationService from '#services/notification_service'
import { purchaseValidator } from '#validators/order'
import logger from '@adonisjs/core/services/logger'

export default class ShopController {
  async index({ inertia, auth }: HttpContext) {
    const shopService = new ShopService()
    const user = auth.user!

    const [products, categories] = await Promise.all([
      shopService.getProducts({
        showAll: user.showAllProducts,
        userId: user.id,
      }),
      shopService.getCategories(),
    ])

    return inertia.render('shop/index', { products, categories })
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
