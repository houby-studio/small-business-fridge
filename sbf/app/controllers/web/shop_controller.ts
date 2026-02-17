import type { HttpContext } from '@adonisjs/core/http'

export default class ShopController {
  async index({ inertia }: HttpContext) {
    // TODO: Phase 3 — Load products with stock via ProductService
    return inertia.render('shop/index', { products: [] })
  }

  async purchase({ response }: HttpContext) {
    // TODO: Phase 3 — OrderService.purchase()
    return response.redirect('/shop')
  }
}
