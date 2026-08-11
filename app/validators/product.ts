import vine from '@vinejs/vine'

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
  })
)
