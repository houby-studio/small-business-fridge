import type { HttpContext } from '@adonisjs/core/http'
import ShopService from '#services/shop_service'
import Product from '#models/product'

export default class ProductsController {
  async index({ auth, response }: HttpContext) {
    const shopService = new ShopService()
    const products = await shopService.getProducts({ showAll: false, userId: auth.user!.id })
    return response.json({ data: products })
  }

  async show({ params, response }: HttpContext) {
    const product = await Product.query()
      .where('barcode', params.barcode)
      .preload('category')
      .preload('deliveries', (q) => q.where('amountLeft', '>', 0))
      .first()

    if (!product) {
      return response.notFound({ error: 'Product not found.' })
    }

    const stockSum = product.deliveries.reduce((sum, d) => sum + d.amountLeft, 0)
    const cheapest = product.deliveries.sort((a, b) => a.price - b.price)[0]

    return response.json({
      data: {
        id: product.id,
        keypadId: product.keypadId,
        displayName: product.displayName,
        barcode: product.barcode,
        category: product.category.name,
        stockSum,
        price: cheapest?.price ?? null,
        deliveryId: cheapest?.id ?? null,
      },
    })
  }
}
