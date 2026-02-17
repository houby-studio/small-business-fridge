import vine from '@vinejs/vine'

export const updateUserValidator = vine.compile(
  vine.object({
    role: vine.enum(['customer', 'supplier', 'admin'] as const).optional(),
    isDisabled: vine.boolean().optional(),
    isKiosk: vine.boolean().optional(),
  })
)
