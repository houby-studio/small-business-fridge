import type { HttpContext } from '@adonisjs/core/http'
import { readFile } from 'node:fs/promises'
import ProductImageService from '#services/product_images/product_image_service'
import { lookupOpenFoodFacts } from '#services/product_images/open_food_facts'
import {
  processProductImageValidator,
  productImageCandidatesValidator,
} from '#validators/product_image'
import { isDomainError } from '#services/domain_error'

export default class ProductImagesController {
  /**
   * Runs the image pipeline and returns the finished WebP. Nothing is stored — the
   * product form submits the result like any other upload, so preview and save stay one
   * step apart and the supplier can retry with other options.
   */
  async process({ request, response, i18n }: HttpContext) {
    const data = await request.validateUsing(processProductImageValidator)
    const service = new ProductImageService()

    try {
      const input = data.image
        ? await readFile(data.image.tmpPath!)
        : await service.downloadFromUrl(data.url!)
      const result = await service.process(input, {
        background: data.background ?? 'auto',
        rotate: data.rotate ?? 'auto',
      })
      return response
        .header('Content-Type', 'image/webp')
        .header('Cache-Control', 'no-store')
        .header('X-Image-Background', result.background)
        .header('X-Image-Rotated', result.rotated ?? 'none')
        .send(result.buffer)
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

  /** Candidate pictures for a barcode (Open Food Facts). */
  async candidates({ request, response }: HttpContext) {
    const { barcode } = await request.validateUsing(productImageCandidatesValidator, {
      data: request.qs(),
    })
    return response.ok(await lookupOpenFoodFacts(barcode))
  }
}
