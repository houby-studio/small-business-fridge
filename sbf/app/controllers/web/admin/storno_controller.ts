import type { HttpContext } from '@adonisjs/core/http'

export default class StornoController {
  async store({ response }: HttpContext) {
    // TODO: Phase 6 — Cancel/reverse an order
    return response.redirect('/admin/orders')
  }
}
