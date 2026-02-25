import vine from '@vinejs/vine'

export const createCategoryValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(100),
    color: vine
      .string()
      .trim()
      .regex(/^#[0-9A-Fa-f]{6}$/),
  })
)

export const updateCategoryValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(100).optional(),
    color: vine
      .string()
      .trim()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
    isDisabled: vine.boolean().optional(),
  })
)
