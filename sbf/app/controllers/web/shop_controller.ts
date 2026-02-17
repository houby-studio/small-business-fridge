import type { HttpContext } from '@adonisjs/core/http'
import ShopService from '#services/shop_service'
import OrderService from '#services/order_service'
import { purchaseValidator } from '#validators/order'

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

  async purchase({ request, auth, response, session }: HttpContext) {
    const { deliveryId } = await request.validateUsing(purchaseValidator)
    const orderService = new OrderService()

    try {
      await orderService.purchase(auth.user!.id, deliveryId, 'web')
      session.flash('alert', { type: 'success', message: 'Nákup proběhl úspěšně.' })
    } catch (error) {
      if (error instanceof Error && error.message === 'OUT_OF_STOCK') {
        session.flash('alert', { type: 'danger', message: 'Produkt není skladem.' })
      } else {
        session.flash('alert', { type: 'danger', message: 'Nákup se nezdařil.' })
      }
    }

    return response.redirect('/shop')
  }
}
