import vine from '@vinejs/vine'
import {
  PRODUCT_IMAGE_SOURCE_EXTNAMES,
  PRODUCT_IMAGE_SOURCE_MAX_SIZE,
} from '#validators/product_image'
import { BACKGROUND_MODES } from '#services/product_images/product_image_service'

/**
 * Contributing to Open Food Facts: the consent, and the supplier's own photo as it was
 * picked (before the pipeline) with the background choice they saw in the preview.
 */
const offContributionFields = {
  offContribute: vine.boolean().optional(),
  offOriginal: vine
    .file({ size: PRODUCT_IMAGE_SOURCE_MAX_SIZE, extnames: PRODUCT_IMAGE_SOURCE_EXTNAMES })
    .optional(),
  offBackground: vine.enum(BACKGROUND_MODES).optional(),
}

function parseAllergenIds() {
  return vine
    .any()
    .optional()
    .transform((v) => {
      if (v === undefined || v === null) return []
      // FormData stringifies everything, so an array arrives as ['3', '7'] from the browser
      // and as [3, 7] from JSON/MCP. Coerce instead of filtering the strings out — that
      // silently dropped every allergen picked in the create form.
      if (Array.isArray(v)) {
        return v.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      }
      if (typeof v === 'string') {
        try {
          const p = JSON.parse(v) as unknown
          return Array.isArray(p)
            ? p.filter((n): n is number => typeof n === 'number' && n > 0)
            : []
        } catch {
          return v
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n) && n > 0)
        }
      }
      return []
    })
}

export const createProductValidator = vine.compile(
  vine.object({
    displayName: vine.string().trim().minLength(1).maxLength(255),
    description: vine.string().trim().maxLength(1000),
    categoryId: vine.number().positive(),
    barcode: vine.string().trim().maxLength(100).optional(),
    image: vine.file({ size: '5mb', extnames: ['jpg', 'jpeg', 'png', 'webp'] }),
    allergenIds: parseAllergenIds(),
    ...offContributionFields,
  })
)

export const updateProductValidator = vine.compile(
  vine.object({
    displayName: vine.string().trim().minLength(1).maxLength(255),
    description: vine.string().trim().maxLength(1000),
    categoryId: vine.number().positive(),
    barcode: vine.string().trim().maxLength(100).optional(),
    image: vine.file({ size: '5mb', extnames: ['jpg', 'jpeg', 'png', 'webp'] }).optional(),
    allergenIds: parseAllergenIds(),
    ...offContributionFields,
  })
)
