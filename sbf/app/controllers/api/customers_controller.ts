import type { HttpContext } from '@adonisjs/core/http'

export default class CustomersController {
  async show({ response }: HttpContext) {
    // TODO: Phase 3 — Get customer info
    return response.json({ data: null })
  }

  async insights({ response }: HttpContext) {
    // TODO: Phase 3 — Customer purchase insights
    return response.json({ data: null })
  }
}
