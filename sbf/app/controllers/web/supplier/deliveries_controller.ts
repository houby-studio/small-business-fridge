import type { HttpContext } from '@adonisjs/core/http'
import DeliveryService from '#services/delivery_service'
import { createDeliveryValidator } from '#validators/delivery'
import { normalizeImagePath } from '#helpers/image_url'

export default class DeliveriesController {
  async index({ inertia, auth, request }: HttpContext) {
    const service = new DeliveryService()
    const page = request.input('page', 1)
    const productId = request.input('productId')
    const sortBy = request.input('sortBy')
    const sortOrder = request.input('sortOrder')

    const [products, recentDeliveries] = await Promise.all([
      service.getAllProducts(),
      service.getRecentDeliveries(auth.user!.id, page, 20, {
        productId: productId ? Number(productId) : undefined,
        sortBy: sortBy || undefined,
        sortOrder: sortOrder || undefined,
      }),
    ])

    return inertia.render('supplier/deliveries/index', {
      products: products.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        imagePath: normalizeImagePath(p.imagePath),
        category: p.category ? { name: p.category.name, color: p.category.color } : null,
      })),
      recentDeliveries: recentDeliveries.serialize(),
      filters: {
        productId: productId || '',
        sortBy: sortBy || '',
        sortOrder: sortOrder || '',
      },
    })
  }

  async store({ request, response, auth, session, i18n }: HttpContext) {
    const data = await request.validateUsing(createDeliveryValidator)

    const service = new DeliveryService()
    await service.addStock(auth.user!.id, data.productId, data.amount, data.price)

    session.flash('alert', {
      type: 'success',
      message: i18n.t('messages.delivery_created', { amount: data.amount, price: data.price }),
    })

    return response.redirect('/supplier/deliveries')
  }
}
