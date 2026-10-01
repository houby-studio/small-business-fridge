import vine from '@vinejs/vine'

export const productSuggestionValidator = vine.compile(
  vine.object({
    field: vine.enum(['description', 'classification'] as const),
    name: vine.string().trim().minLength(1).maxLength(255),
    barcode: vine
      .string()
      .trim()
      .regex(/^\d{8,14}$/)
      .optional(),
    currentDescription: vine.string().trim().maxLength(1000).optional(),
  })
)
