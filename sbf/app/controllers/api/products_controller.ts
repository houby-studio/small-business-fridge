import type { HttpContext } from '@adonisjs/core/http'

export default class ProductsController {
  async index({ response }: HttpContext) {
    // TODO: Phase 3 — List all products with stock
    return response.json({ data: [] })
  }

  async show({ response }: HttpContext) {
    // TODO: Phase 3 — Get product by barcode
    return response.json({ data: null })
  }
}
