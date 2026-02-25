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

export const purchaseBasketValidator = vine.compile(
  vine.object({
    customerId: vine.number().positive(),
    items: vine
      .array(
        vine.object({
          deliveryId: vine.number().positive(),
          quantity: vine.number().positive().max(99),
        })
      )
      .minLength(1),
  })
)
