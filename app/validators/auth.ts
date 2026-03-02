import vine from '@vinejs/vine'

export const loginValidator = vine.compile(
  vine.object({
    email: vine.string().trim().email({ require_tld: false }).maxLength(255),
    password: vine.string().minLength(1),
    rememberMe: vine.boolean().optional(),
  })
)

export const bootstrapAdminValidator = vine.compile(
  vine.object({
    displayName: vine.string().trim().minLength(1).maxLength(255),
    email: vine.string().trim().email({ require_tld: false }).maxLength(255),
    password: vine.string().minLength(8),
    passwordConfirmation: vine.string().minLength(8),
  })
)

export const apiTokenLoginValidator = vine.compile(
  vine.object({
    email: vine.string().trim().email({ require_tld: false }).maxLength(255),
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

export const registerValidator = vine.compile(
  vine.object({
    displayName: vine.string().trim().minLength(1).maxLength(255),
    email: vine.string().trim().email({ require_tld: false }).maxLength(255),
    password: vine.string().minLength(8),
    passwordConfirmation: vine.string().minLength(8),
  })
)

export const createInviteValidator = vine.compile(
  vine.object({
    email: vine.string().trim().email({ require_tld: false }).maxLength(255),
    role: vine.enum(['customer', 'supplier', 'admin'] as const).optional(),
    expiresInHours: vine
      .number()
      .min(1)
      .max(24 * 365)
      .optional(),
  })
)

export const acceptInviteValidator = vine.compile(
  vine.object({
    displayName: vine.string().trim().minLength(1).maxLength(255),
    password: vine.string().minLength(8),
    passwordConfirmation: vine.string().minLength(8),
  })
)

export const forgotPasswordValidator = vine.compile(
  vine.object({
    email: vine.string().trim().email({ require_tld: false }).maxLength(255),
  })
)

export const resetPasswordValidator = vine.compile(
  vine.object({
    password: vine.string().minLength(8),
    passwordConfirmation: vine.string().minLength(8),
  })
)

export const changePasswordValidator = vine.compile(
  vine.object({
    currentPassword: vine.string().minLength(1).optional(),
    newPassword: vine.string().minLength(8),
    newPasswordConfirmation: vine.string().minLength(8),
  })
)

export const sensitiveReauthValidator = vine.compile(
  vine.object({
    currentPassword: vine.string().minLength(1).optional().nullable(),
  })
)

export const oidcLinkStartValidator = vine.compile(
  vine.object({
    provider: vine.enum(['microsoft', 'discord'] as const),
    currentPassword: vine.string().minLength(1).optional().nullable(),
  })
)
