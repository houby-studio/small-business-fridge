import type { HttpContext } from '@adonisjs/core/http'
import AdminService from '#services/admin_service'

export default class OrdersController {
  async index({ inertia, request }: HttpContext) {
    const page = request.input('page', 1)
    const service = new AdminService()
    const orders = await service.getAllOrders(page)

    return inertia.render('admin/orders/index', {
      orders: orders.serialize(),
    })
  }
}
