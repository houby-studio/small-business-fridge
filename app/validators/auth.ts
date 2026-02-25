import vine from '@vinejs/vine'

export const loginValidator = vine.compile(
  vine.object({
    username: vine.string().trim().minLength(1),
    password: vine.string().minLength(1),
    rememberMe: vine.boolean().optional(),
  })
)

export const apiTokenLoginValidator = vine.compile(
  vine.object({
    username: vine.string().trim().minLength(1),
    password: vine.string().minLength(1),
  })
)

export const apiKeypadLoginValidator = vine.compile(
  vine.object({
    keypadId: vine.number().positive().optional(),
    cardId: vine.string().trim().optional(),
    apiSecret: vine.string().trim().minLength(1),
  })
)

export const createApiTokenValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(100),
    expiresInDays: vine.number().min(1).max(3650).optional(),
  })
)
