import type { HttpContext } from '@adonisjs/core/http'
import AdminService from '#services/admin_service'
import { createCategoryValidator, updateCategoryValidator } from '#validators/category'

export default class CategoriesController {
  async index({ inertia }: HttpContext) {
    const service = new AdminService()
    const categories = await service.getCategories()

    return inertia.render('admin/categories/index', {
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        isDisabled: c.isDisabled,
      })),
    })
  }

  async store({ request, response, session, i18n }: HttpContext) {
    const data = await request.validateUsing(createCategoryValidator)

    const service = new AdminService()
    await service.createCategory(data.name, data.color)

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.category_created', { name: data.name }),
    })

    return response.redirect('/admin/categories')
  }

  async update({ params, request, response, session, i18n }: HttpContext) {
    const data = await request.validateUsing(updateCategoryValidator)

    const service = new AdminService()
    const category = await service.updateCategory(params.id, data)

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.category_updated', { name: category.name }),
    })

    return response.redirect('/admin/categories')
  }
}
