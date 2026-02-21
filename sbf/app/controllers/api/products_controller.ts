import type { HttpContext } from '@adonisjs/core/http'
import ShopService from '#services/shop_service'
import Product from '#models/product'

export default class ProductsController {
  /**
   * @summary List available products
   * @description Returns all products visible to the authenticated user. Out-of-stock products are excluded unless the user has showAllProducts enabled.
   * @tag Products
   * @responseBody 200 - {"data": [{"id": 1, "keypadId": 1, "displayName": "Kofola 0.5l", "barcode": "8590121052023", "category": "Nápoje", "stockSum": 12, "price": 25, "deliveryId": 3}]}
   * @responseBody 401 - {"error": "Unauthorized"}
   */
  async index({ auth, response }: HttpContext) {
    const shopService = new ShopService()
    const products = await shopService.getProducts({ showAll: false, userId: auth.user!.id })
    return response.json({ data: products })
  }

  /**
   * @summary Get product by barcode
   * @description Returns a single product with current stock and cheapest delivery price.
   * @tag Products
   * @paramPath barcode - Product barcode (EAN) - @type(string)
   * @responseBody 200 - {"data": {"id": 1, "keypadId": 1, "displayName": "Kofola 0.5l", "barcode": "8590121052023", "category": "Nápoje", "stockSum": 12, "price": 25, "deliveryId": 3}}
   * @responseBody 401 - {"error": "Unauthorized"}
   * @responseBody 404 - {"error": "Product not found."}
   */
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
