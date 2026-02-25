import vine from '@vinejs/vine'

export const createAllergenValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(100),
  })
)

export const updateAllergenValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(100).optional(),
    isDisabled: vine.boolean().optional(),
  })
)
