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

/**
 * The purchase group, from FormData ('' or 'null' = none) or JSON. Absent = not sent, so
 * an older client never clears a group it does not know about. Nullable because the
 * bodyparser turns the empty FormData value into null, which `optional()` alone would drop.
 */
function parseProductGroupId() {
  return vine
    .any()
    .nullable()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined
      if (v === null || v === '' || v === 'null') return null
      const n = Number(v)
      return Number.isInteger(n) && n > 0 ? n : null
    })
}

/** Shared with the MCP zod schemas and mirrored in inertia/composables/use_product_form_validation.ts */
export const PRODUCT_NAME_MAX = 255
export const PRODUCT_DESCRIPTION_MAX = 1000
export const PRODUCT_BARCODE_MAX = 100

export const createProductValidator = vine.compile(
  vine.object({
    displayName: vine.string().trim().minLength(1).maxLength(PRODUCT_NAME_MAX),
    description: vine.string().trim().maxLength(PRODUCT_DESCRIPTION_MAX),
    categoryId: vine.number().positive(),
    barcode: vine.string().trim().maxLength(PRODUCT_BARCODE_MAX).optional(),
    image: vine.file({ size: '5mb', extnames: ['jpg', 'jpeg', 'png', 'webp'] }),
    allergenIds: parseAllergenIds(),
    productGroupId: parseProductGroupId(),
    ...offContributionFields,
  })
)

export const updateProductValidator = vine.compile(
  vine.object({
    displayName: vine.string().trim().minLength(1).maxLength(PRODUCT_NAME_MAX),
    description: vine.string().trim().maxLength(PRODUCT_DESCRIPTION_MAX),
    categoryId: vine.number().positive(),
    barcode: vine.string().trim().maxLength(PRODUCT_BARCODE_MAX).optional(),
    image: vine.file({ size: '5mb', extnames: ['jpg', 'jpeg', 'png', 'webp'] }).optional(),
    allergenIds: parseAllergenIds(),
    productGroupId: parseProductGroupId(),
    ...offContributionFields,
  })
)
