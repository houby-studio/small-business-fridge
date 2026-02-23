import type { HttpContext } from '@adonisjs/core/http'
import AdminService from '#services/admin_service'
import { createAllergenValidator, updateAllergenValidator } from '#validators/allergen'
import AuditService from '#services/audit_service'
import Allergen from '#models/allergen'

export default class AllergensController {
  async index({ inertia }: HttpContext) {
    const service = new AdminService()
    const allergens = await service.getAllergens()
    const allergenIdsWithProducts = await service.getAllergenIdsWithProducts(
      allergens.map((allergen) => allergen.id)
    )

    return inertia.render('admin/allergens/index', {
      allergens: allergens.map((a) => ({
        id: a.id,
        name: a.name,
        isDisabled: a.isDisabled,
        hasProducts: allergenIdsWithProducts.has(a.id),
      })),
    })
  }

  async store({ request, response, session, i18n, auth }: HttpContext) {
    const data = await request.validateUsing(createAllergenValidator)

    const service = new AdminService()
    const allergen = await service.createAllergen(data.name)

    AuditService.log(auth.user!.id, 'allergen.created', 'allergen', allergen.id, null, {
      name: allergen.name,
      isDisabled: allergen.isDisabled,
    })

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.allergen_created', { name: data.name }),
    })

    return response.redirect('/admin/allergens')
  }

  async update({ params, request, response, session, i18n, auth }: HttpContext) {
    const data = await request.validateUsing(updateAllergenValidator)

    const allergenBefore = await Allergen.findOrFail(Number(params.id))
    const before = {
      name: allergenBefore.name,
      isDisabled: allergenBefore.isDisabled,
    }

    const service = new AdminService()
    let allergen: Allergen
    try {
      allergen = await service.updateAllergen(Number(params.id), data)
    } catch (err) {
      if (err instanceof Error && err.message === 'ALLERGEN_HAS_PRODUCTS') {
        session.flash('alert', {
          type: 'warn',
          message: i18n.t('messages.allergen_has_products'),
        })
        return response.redirect('/admin/allergens')
      }
      throw err
    }

    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const key of ['name', 'isDisabled'] as const) {
      if (data[key] !== undefined && before[key] !== allergen[key]) {
        changes[key] = { from: before[key], to: allergen[key] }
      }
    }

    if (Object.keys(changes).length > 0) {
      AuditService.log(auth.user!.id, 'allergen.updated', 'allergen', allergen.id, null, changes)
    }

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.allergen_updated', { name: allergen.name }),
    })

    return response.redirect('/admin/allergens')
  }
}
