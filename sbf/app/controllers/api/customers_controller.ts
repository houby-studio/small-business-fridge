import type { HttpContext } from '@adonisjs/core/http'

export default class CustomersController {
  /**
   * @summary Get customer info
   * @description Returns customer profile information. (Not yet implemented.)
   * @tag Customers
   * @paramPath id - Customer user ID - @type(integer)
   * @responseBody 200 - {"data": null}
   * @responseBody 401 - {"error": "Unauthorized"}
   */
  async show({ response }: HttpContext) {
    // TODO: Phase 3 — Get customer info
    return response.json({ data: null })
  }

  /**
   * @summary Get customer purchase insights
   * @description Returns spending stats and purchase history. (Not yet implemented.)
   * @tag Customers
   * @paramPath id - Customer user ID - @type(integer)
   * @responseBody 200 - {"data": null}
   * @responseBody 401 - {"error": "Unauthorized"}
   */
  async insights({ response }: HttpContext) {
    // TODO: Phase 3 — Customer purchase insights
    return response.json({ data: null })
  }
}
