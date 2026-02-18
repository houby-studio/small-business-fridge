import vine from '@vinejs/vine'

export const paymentActionValidator = vine.compile(
  vine.object({
    action: vine.enum(['approve', 'reject'] as const),
  })
)
