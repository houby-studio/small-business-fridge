import type { HttpContext } from '@adonisjs/core/http'
import Category from '#models/category'
import Product from '#models/product'
import ProductGroupService from '#services/shopping/product_group_service'
import type { ProductGroupErrorCode } from '#services/shopping/product_group_service'
import { isDomainError } from '#services/domain_error'
import { productGroupValidator } from '#validators/shopping'

const ERROR_MESSAGES: Record<ProductGroupErrorCode, string> = {
  GROUP_NOT_FOUND: 'messages.product_group_not_found',
  GROUP_NAME_TAKEN: 'messages.name_taken',
  CATEGORY_NOT_FOUND: 'messages.product_group_category_missing',
}

export default class ProductGroupsController {
  async index({ inertia }: HttpContext) {
    const [groups, categories, products] = await Promise.all([
      new ProductGroupService().list(),
      Category.query().where('isDisabled', false).orderBy('name', 'asc'),
      // Archived products cannot join a group; a member that was archived stays listed.
      Product.query()
        .where((q) => q.whereNull('archivedAt').orWhereNotNull('productGroupId'))
        .orderBy('displayName', 'asc')
        .select('id', 'displayName', 'categoryId', 'productGroupId'),
    ])

    return inertia.render('supplier/product_groups/index', {
      groups,
      categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
      products: products.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        categoryId: p.categoryId,
        productGroupId: p.productGroupId,
      })),
    })
  }

  async store({ request, response, auth, session, i18n }: HttpContext) {
    const data = await request.validateUsing(productGroupValidator)
    try {
      const group = await new ProductGroupService().create(auth.user!.id, data)
      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.product_group_created', { name: group.name }),
      })
    } catch (error) {
      this.flashError(error, session, i18n)
    }
    return response.redirect('back', true)
  }

  async update({ params, request, response, auth, session, i18n }: HttpContext) {
    const data = await request.validateUsing(productGroupValidator)
    try {
      const group = await new ProductGroupService().update(auth.user!.id, Number(params.id), data)
      session.flash('alert', {
        type: 'success',
        message: i18n.t('messages.product_group_updated', { name: group.name }),
      })
    } catch (error) {
      this.flashError(error, session, i18n)
    }
    return response.redirect('back', true)
  }

  async destroy({ params, response, auth, session, i18n }: HttpContext) {
    try {
      await new ProductGroupService().delete(auth.user!.id, Number(params.id))
      session.flash('alert', { type: 'success', message: i18n.t('messages.product_group_deleted') })
    } catch (error) {
      this.flashError(error, session, i18n)
    }
    return response.redirect('back', true)
  }

  private flashError(error: unknown, session: HttpContext['session'], i18n: HttpContext['i18n']) {
    if (!isDomainError<ProductGroupErrorCode>(error)) throw error
    session.flash('alert', { type: 'danger', message: i18n.t(ERROR_MESSAGES[error.code]) })
  }
}
