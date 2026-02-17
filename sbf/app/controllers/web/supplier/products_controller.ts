import type { HttpContext } from '@adonisjs/core/http'

export default class ProductsController {
  async create({ inertia }: HttpContext) {
    // TODO: Phase 5 — New product form with categories
    return inertia.render('supplier/products/create', { categories: [] })
  }

  async store({ response }: HttpContext) {
    // TODO: Phase 5 — Create product
    return response.redirect('/supplier/stock')
  }

  async edit({ inertia }: HttpContext) {
    // TODO: Phase 5 — Edit product form
    return inertia.render('supplier/products/edit', { product: null, categories: [] })
  }

  async update({ response }: HttpContext) {
    // TODO: Phase 5 — Update product
    return response.redirect('/supplier/stock')
  }
}
