import type { HttpContext } from '@adonisjs/core/http'
import ShopService from '#services/shop_service'
import Product from '#models/product'
import type {
  ProductBarcodeResponse,
  ProductListResponse,
  ProductResponse,
} from '#interfaces/api_responses'

export default class ProductsController {
  /**
   * @index
   * @summary List available products
   * @description Returns all products visible to the authenticated user. Out-of-stock products are excluded unless the user has showAllProducts enabled.
   * @tag Products
   * @responseBody 200 - <ProductListResponse>
   * @responseBody 401 - <ApiErrorResponse>
   */
  async index({ auth, response }: HttpContext) {
    const shopService = new ShopService()
    const products: ProductResponse[] = await shopService.getProducts({
      showAll: false,
      userId: auth.user!.id,
    })
    const payload: ProductListResponse = { data: products }
    return response.json(payload)
  }

  /**
   * @show
   * @summary Get product by barcode
   * @description Returns a single product with current stock and the price of the delivery lot sold next (oldest in stock — strict FIFO).
   * @tag Products
   * @paramPath barcode - Product barcode (EAN) - @type(string) @required
   * @responseBody 200 - <ProductBarcodeResponse>
   * @responseBody 401 - <ApiErrorResponse>
   * @responseBody 404 - <ApiErrorResponse>
   */
  async show({ params, response }: HttpContext) {
    const product = await Product.query()
      .where('barcode', params.barcode)
      .preload('category')
      .preload('allergens')
      .preload('deliveries', (q) => q.where('amountLeft', '>', 0))
      .first()

    if (!product) {
      return response.notFound({ error: 'Product not found.' })
    }

    const stockSum = product.deliveries.reduce((sum, d) => sum + d.amountLeft, 0)
    // Strict FIFO: the oldest in-stock lot is the one a purchase will use.
    const nextLot = product.deliveries.sort(
      (a, b) => a.createdAt.toMillis() - b.createdAt.toMillis() || a.id - b.id
    )[0]

    const payload: ProductBarcodeResponse = {
      data: {
        id: product.id,
        keypadId: product.keypadId,
        displayName: product.displayName,
        barcode: product.barcode,
        category: product.category.name,
        allergens: product.allergens.map((a) => ({ id: a.id, name: a.name })),
        stockSum,
        price: nextLot?.price ?? null,
        deliveryId: nextLot?.id ?? null,
      },
    }
    return response.json(payload)
  }
}
