import vine from '@vinejs/vine'

export const createProductValidator = vine.compile(
  vine.object({
    displayName: vine.string().trim().minLength(1).maxLength(255),
    description: vine.string().trim().maxLength(1000),
    categoryId: vine.number().positive(),
    barcode: vine.string().trim().maxLength(100).optional(),
    image: vine.file({ size: '5mb', extnames: ['jpg', 'jpeg', 'png', 'webp'] }).optional(),
  })
)

export const updateProductValidator = vine.compile(
  vine.object({
    displayName: vine.string().trim().minLength(1).maxLength(255),
    description: vine.string().trim().maxLength(1000),
    categoryId: vine.number().positive(),
    barcode: vine.string().trim().maxLength(100).optional(),
    image: vine.file({ size: '5mb', extnames: ['jpg', 'jpeg', 'png', 'webp'] }).optional(),
  })
)
