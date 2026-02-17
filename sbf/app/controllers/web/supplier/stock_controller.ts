import type { HttpContext } from '@adonisjs/core/http'
import DeliveryService from '#services/delivery_service'

export default class StockController {
  async index({ inertia, auth }: HttpContext) {
    const service = new DeliveryService()
    const stock = await service.getStockForSupplier(auth.user!.id)

    return inertia.render('supplier/stock/index', { stock })
  }
}
