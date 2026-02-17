import type { HttpContext } from '@adonisjs/core/http'

export default class KioskController {
  async index({ inertia }: HttpContext) {
    // TODO: Phase 8 — Kiosk keypad interface
    return inertia.render('kiosk/index')
  }

  async shop({ inertia }: HttpContext) {
    // TODO: Phase 8 — Kiosk shop view
    return inertia.render('kiosk/shop', { products: [] })
  }
}
