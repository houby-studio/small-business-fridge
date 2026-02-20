import vine from '@vinejs/vine'

export const updateUserValidator = vine.compile(
  vine.object({
    role: vine.enum(['customer', 'supplier', 'admin'] as const).optional(),
    isDisabled: vine.boolean().optional(),
    isKiosk: vine.boolean().optional(),
  })
)

export const toggleColorModeValidator = vine.compile(
  vine.object({
    colorMode: vine.enum(['light', 'dark'] as const),
  })
)

export const updateProfileValidator = vine.compile(
  vine.object({
    displayName: vine.string().trim().minLength(1).maxLength(255),
    email: vine.string().trim().email({ require_tld: false }).maxLength(255),
    phone: vine.string().trim().maxLength(20).optional().nullable(),
    iban: vine.string().trim().maxLength(24).optional().nullable(),
    showAllProducts: vine.boolean(),
    sendMailOnPurchase: vine.boolean(),
    sendDailyReport: vine.boolean(),
    colorMode: vine.enum(['light', 'dark'] as const),
    keypadDisabled: vine.boolean(),
  })
)
