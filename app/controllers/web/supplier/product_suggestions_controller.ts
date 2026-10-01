import type { HttpContext } from '@adonisjs/core/http'
import ProductSuggestionService from '#services/product_ai/product_suggestion_service'
import { productSuggestionValidator } from '#validators/product_suggestion'
import { isDomainError } from '#services/domain_error'

export default class ProductSuggestionsController {
  /** Suggestions for the product form: a description, or a category and allergens. */
  async suggest({ request, response, i18n }: HttpContext) {
    const data = await request.validateUsing(productSuggestionValidator)
    const service = new ProductSuggestionService()
    try {
      if (data.field === 'description') {
        return response.ok({ description: await service.suggestDescription(data) })
      }
      return response.ok(await service.suggestClassification(data))
    } catch (error) {
      if (isDomainError(error)) {
        return response.unprocessableEntity({
          error: error.code,
          message: i18n.t(`supplier.${error.code}`),
        })
      }
      throw error
    }
  }
}
