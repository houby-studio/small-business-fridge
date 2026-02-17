import type { HttpContext } from '@adonisjs/core/http'

export default class DashboardController {
  async index({ inertia }: HttpContext) {
    // TODO: Phase 6 — Admin dashboard with stats
    return inertia.render('admin/dashboard')
  }
}
