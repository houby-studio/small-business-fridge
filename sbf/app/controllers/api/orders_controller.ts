import type { HttpContext } from '@adonisjs/core/http'

export default class OrdersController {
  async store({ response }: HttpContext) {
    // TODO: Phase 3 — Unified order creation (keypad, scanner, etc.)
    return response.json({ data: null })
  }

  async latest({ response }: HttpContext) {
    // TODO: Phase 3 — Latest orders for authenticated user
    return response.json({ data: [] })
  }
}
