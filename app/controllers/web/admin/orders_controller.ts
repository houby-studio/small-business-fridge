import type { HttpContext } from '@adonisjs/core/http'
import AdminService from '#services/admin_service'
import db from '@adonisjs/lucid/services/db'

export default class OrdersController {
  async index({ inertia, request }: HttpContext) {
    const page = request.input('page', 1)
    const channel = request.input('channel')
    const invoiced = request.input('invoiced')
    const buyerId = request.input('buyerId')
    const supplierId = request.input('supplierId')
    const sortBy = request.input('sortBy')
    const sortOrder = request.input('sortOrder')

    const service = new AdminService()
    const [orders, buyers, suppliers] = await Promise.all([
      service.getAllOrders(page, 20, {
        channel: channel || undefined,
        invoiced: invoiced || undefined,
        buyerId: buyerId ? Number(buyerId) : undefined,
        supplierId: supplierId ? Number(supplierId) : undefined,
        sortBy: sortBy || undefined,
        sortOrder: sortOrder || undefined,
      }),
      db
        .from('users')
        .join('orders', 'orders.buyer_id', 'users.id')
        .distinct('users.id', 'users.display_name')
        .orderBy('users.display_name', 'asc'),
      db
        .from('users')
        .join('deliveries', 'deliveries.supplier_id', 'users.id')
        .distinct('users.id', 'users.display_name')
        .orderBy('users.display_name', 'asc'),
    ])

    return inertia.render('admin/orders/index', {
      orders: orders.serialize(),
      filters: {
        channel: channel || '',
        invoiced: invoiced || '',
        buyerId: buyerId || '',
        supplierId: supplierId || '',
        sortBy: sortBy || '',
        sortOrder: sortOrder || '',
      },
      buyers: buyers.map((u) => ({ id: Number(u.id), displayName: String(u.display_name) })),
      suppliers: suppliers.map((u) => ({ id: Number(u.id), displayName: String(u.display_name) })),
    })
  }
}
