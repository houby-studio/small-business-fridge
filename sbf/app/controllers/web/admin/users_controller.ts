import type { HttpContext } from '@adonisjs/core/http'

export default class UsersController {
  async index({ inertia }: HttpContext) {
    // TODO: Phase 6 — User management table
    return inertia.render('admin/users/index', { users: [] })
  }

  async update({ response }: HttpContext) {
    // TODO: Phase 6 — Update user role, disabled status, etc.
    return response.redirect('/admin/users')
  }
}
