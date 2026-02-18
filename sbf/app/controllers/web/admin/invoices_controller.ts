import type { HttpContext } from '@adonisjs/core/http'
import AdminService from '#services/admin_service'

export default class InvoicesController {
  async index({ inertia, request }: HttpContext) {
    const page = request.input('page', 1)
    const service = new AdminService()
    const invoices = await service.getAllInvoices(page)

    return inertia.render('admin/invoices/index', {
      invoices: invoices.serialize(),
    })
  }
}
