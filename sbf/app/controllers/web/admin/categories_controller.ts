import type { HttpContext } from '@adonisjs/core/http'

export default class CategoriesController {
  async index({ inertia }: HttpContext) {
    // TODO: Phase 6 — Category management
    return inertia.render('admin/categories/index', { categories: [] })
  }

  async store({ response }: HttpContext) {
    // TODO: Phase 6 — Create category
    return response.redirect('/admin/categories')
  }

  async update({ response }: HttpContext) {
    // TODO: Phase 6 — Update category
    return response.redirect('/admin/categories')
  }
}
