import type { HttpContext } from '@adonisjs/core/http'
import AdminService from '#services/admin_service'

export default class InvoicesController {
  async index({ inertia, request }: HttpContext) {
    const page = request.input('page', 1)
    const status = request.input('status')
    const sortBy = request.input('sortBy')
    const sortOrder = request.input('sortOrder')

    const service = new AdminService()
    const invoices = await service.getAllInvoices(page, 20, {
      status: status || undefined,
      sortBy: sortBy || undefined,
      sortOrder: sortOrder || undefined,
    })

    return inertia.render('admin/invoices/index', {
      invoices: invoices.serialize(),
      filters: {
        status: status || '',
        sortBy: sortBy || '',
        sortOrder: sortOrder || '',
      },
    })
  }
}
