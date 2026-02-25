import type { HttpContext } from '@adonisjs/core/http'
import AdminService from '#services/admin_service'

export default class DashboardController {
  async index({ inertia }: HttpContext) {
    const service = new AdminService()
    const stats = await service.getDashboardStats()

    return inertia.render('admin/dashboard', { stats })
  }
}
