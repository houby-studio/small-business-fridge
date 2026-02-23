import type { HttpContext } from '@adonisjs/core/http'

export default class CustomersController {
  /**
   * @show
   * @summary Get customer info
   * @description Returns customer profile information. (Not yet implemented.)
   * @tag Customers
   * @paramPath id - Customer user ID - @type(integer) @required
   * @responseBody 200 - {"data": {}}
   * @responseBody 401 - {"error": "Unauthorized"}
   */
  async show({ response }: HttpContext) {
    // TODO: Phase 3 — Get customer info
    return response.json({ data: null })
  }

  /**
   * @insights
   * @summary Get customer purchase insights
   * @description Returns spending stats and purchase history. (Not yet implemented.)
   * @tag Customers
   * @paramPath id - Customer user ID - @type(integer) @required
   * @responseBody 200 - {"data": {}}
   * @responseBody 401 - {"error": "Unauthorized"}
   */
  async insights({ response }: HttpContext) {
    // TODO: Phase 3 — Customer purchase insights
    return response.json({ data: null })
  }
}
