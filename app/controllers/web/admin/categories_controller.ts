import type { HttpContext } from '@adonisjs/core/http'
import AdminService from '#services/admin_service'
import { createCategoryValidator, updateCategoryValidator } from '#validators/category'
import AuditService from '#services/audit_service'
import Category from '#models/category'

export default class CategoriesController {
  async index({ inertia }: HttpContext) {
    const service = new AdminService()
    const categories = await service.getCategories()
    const categoryIdsWithProducts = await service.getCategoryIdsWithProducts(
      categories.map((category) => category.id)
    )

    return inertia.render('admin/categories/index', {
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        isDisabled: c.isDisabled,
        hasProducts: categoryIdsWithProducts.has(c.id),
      })),
    })
  }

  async store({ request, response, session, i18n, auth }: HttpContext) {
    const data = await request.validateUsing(createCategoryValidator)

    const service = new AdminService()
    const category = await service.createCategory(data.name, data.color)

    const metadata = {
      name: category.name,
      color: category.color,
      isDisabled: category.isDisabled,
    }

    await AuditService.log(
      auth.user!.id,
      'category.created',
      'category',
      category.id,
      null,
      metadata
    )

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
    let category: Category
    try {
      category = await service.updateCategory(params.id, data)
    } catch (err) {
      if (err instanceof Error && err.message === 'CATEGORY_HAS_PRODUCTS') {
        session.flash('alert', {
          type: 'warn',
          message: i18n.t('messages.category_has_products'),
        })
        return response.redirect('/admin/categories')
      }
      throw err
    }

    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const key of ['name', 'color', 'isDisabled'] as const) {
      if (data[key] !== undefined && before[key] !== category[key]) {
        changes[key] = { from: before[key], to: category[key] }
      }
    }

    if (Object.keys(changes).length > 0) {
      await AuditService.log(
        auth.user!.id,
        'category.updated',
        'category',
        category.id,
        null,
        changes
      )
    }

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.category_updated', { name: category.name }),
    })

    return response.redirect('/admin/categories')
  }

  async destroy({ params, response, session, i18n, auth }: HttpContext) {
    const service = new AdminService()
    let category: Category

    try {
      category = await service.deleteCategory(Number(params.id))
    } catch (err) {
      if (err instanceof Error && err.message === 'CATEGORY_HAS_PRODUCTS') {
        session.flash('alert', {
          type: 'warn',
          message: i18n.t('messages.category_has_products_delete'),
        })
        return response.redirect('/admin/categories')
      }
      throw err
    }

    await AuditService.log(auth.user!.id, 'category.deleted', 'category', category.id, null, {
      name: category.name,
    })

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.category_deleted', { name: category.name }),
    })

    return response.redirect('/admin/categories')
  }
}
