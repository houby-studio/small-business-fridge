import type { HttpContext } from '@adonisjs/core/http'
import AdminService from '#services/admin_service'
import { createCategoryValidator, updateCategoryValidator } from '#validators/category'
import AuditService from '#services/audit_service'
import Category from '#models/category'

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

  async store({ request, response, session, i18n, auth }: HttpContext) {
    const data = await request.validateUsing(createCategoryValidator)

    const service = new AdminService()
    const category = await service.createCategory(data.name, data.color)

    AuditService.log(auth.user!.id, 'category.created', 'category', category.id, null, {
      name: category.name,
      color: category.color,
      isDisabled: category.isDisabled,
    })

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.category_created', { name: data.name }),
    })

    return response.redirect('/admin/categories')
  }

  async update({ params, request, response, session, i18n, auth }: HttpContext) {
    const data = await request.validateUsing(updateCategoryValidator)

    const categoryBefore = await Category.findOrFail(params.id)
    const before = {
      name: categoryBefore.name,
      color: categoryBefore.color,
      isDisabled: categoryBefore.isDisabled,
    }

    const service = new AdminService()
    const category = await service.updateCategory(params.id, data)

    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const key of ['name', 'color', 'isDisabled'] as const) {
      if (data[key] !== undefined && before[key] !== category[key]) {
        changes[key] = { from: before[key], to: category[key] }
      }
    }

    AuditService.log(
      auth.user!.id,
      'category.updated',
      'category',
      category.id,
      null,
      Object.keys(changes).length ? changes : null
    )

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.category_updated', { name: category.name }),
    })

    return response.redirect('/admin/categories')
  }
}
