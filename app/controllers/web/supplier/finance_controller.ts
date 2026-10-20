import type { HttpContext } from '@adonisjs/core/http'
import { resolvePage } from '#helpers/pagination'
import FinanceService from '#services/finance_service'
import AuditService from '#services/audit_service'
import { supplierSettingsValidator } from '#validators/inventory'

/** What the supplier earns, what shrinkage costs them, and their margin setting. */
export default class FinanceController {
  async index({ inertia, auth, request }: HttpContext) {
    const user = auth.user!
    const service = new FinanceService()
    const years = await service.yearOptions(user.id)
    const requested = Number(request.input('year'))
    const year = years.includes(requested) ? requested : years[0]
    const page = resolvePage(request.input('page', 1))
    const sortBy = request.input('sortBy') || undefined
    const sortOrder = request.input('sortOrder') || undefined
    const marginPercent = Number(user.marginPercent ?? 0)

    const [summary, products] = await Promise.all([
      service.getSummary(user.id, year, marginPercent),
      service.getProductBreakdown(user.id, year, page, 20, { sortBy, sortOrder }),
    ])

    return inertia.render('supplier/finance/index', {
      summary,
      products,
      years,
      filters: { year: String(year), sortBy: sortBy ?? '', sortOrder: sortOrder ?? '' },
    })
  }

  async updateSettings({ request, response, auth, session, i18n }: HttpContext) {
    const data = await request.validateUsing(supplierSettingsValidator)
    const user = auth.user!
    const before = Number(user.marginPercent ?? 0)
    user.marginPercent = data.marginPercent
    await user.save()

    if (before !== data.marginPercent) {
      await AuditService.log(user.id, 'supplier.settings_updated', 'user', user.id, null, {
        marginPercent: { from: before, to: data.marginPercent },
      })
    }
    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.margin_updated', { margin: data.marginPercent }),
    })
    return response.redirect('back', true)
  }
}
