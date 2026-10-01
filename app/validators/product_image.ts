import vine from '@vinejs/vine'
import { BACKGROUND_MODES, ROTATE_MODES } from '#services/product_images/product_image_service'

/** Upload limit for the source image; the stored result is a small WebP. */
export const PRODUCT_IMAGE_SOURCE_MAX_SIZE = '15mb'
export const PRODUCT_IMAGE_SOURCE_EXTNAMES = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']

export const processProductImageValidator = vine.compile(
  vine.object({
    image: vine
      .file({ size: PRODUCT_IMAGE_SOURCE_MAX_SIZE, extnames: PRODUCT_IMAGE_SOURCE_EXTNAMES })
      .optional()
      .requiredIfMissing('url'),
    url: vine
      .string()
      .trim()
      .maxLength(2048)
      .url({ require_protocol: true, protocols: ['http', 'https'] })
      .optional(),
    background: vine.enum(BACKGROUND_MODES).optional(),
    rotate: vine.enum(ROTATE_MODES).optional(),
  })
)

export const productImageCandidatesValidator = vine.compile(
  vine.object({
    barcode: vine
      .string()
      .trim()
      .regex(/^\d{8,14}$/),
  })
)
