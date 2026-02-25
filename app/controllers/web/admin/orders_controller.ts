import type { HttpContext } from '@adonisjs/core/http'
import AdminService from '#services/admin_service'

export default class OrdersController {
  async index({ inertia, request }: HttpContext) {
    const page = request.input('page', 1)
    const search = request.input('search')
    const channel = request.input('channel')
    const invoiced = request.input('invoiced')
    const sortBy = request.input('sortBy')
    const sortOrder = request.input('sortOrder')

    const service = new AdminService()
    const orders = await service.getAllOrders(page, 20, {
      search: search || undefined,
      channel: channel || undefined,
      invoiced: invoiced || undefined,
      sortBy: sortBy || undefined,
      sortOrder: sortOrder || undefined,
    })

    return inertia.render('admin/orders/index', {
      orders: orders.serialize(),
      filters: {
        search: search || '',
        channel: channel || '',
        invoiced: invoiced || '',
        sortBy: sortBy || '',
        sortOrder: sortOrder || '',
      },
    })
  }
}
