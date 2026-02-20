import vine from '@vinejs/vine'

export const purchaseValidator = vine.compile(
  vine.object({
    deliveryId: vine.number().positive(),
  })
)

export const apiOrderValidator = vine.compile(
  vine.object({
    deliveryId: vine.number().positive(),
    channel: vine.enum(['kiosk', 'scanner'] as const),
  })
)
