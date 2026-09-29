import vine from '@vinejs/vine'

/**
 * `expectedPrice` is the unit price the buyer was shown. When the lot sold next (FIFO)
 * costs anything else, nothing is bought — see OrderService.purchase().
 */
export const purchaseValidator = vine.compile(
  vine.object({
    deliveryId: vine.number().positive(),
    expectedPrice: vine.number().withoutDecimals().min(0).optional(),
  })
)

export const apiOrderValidator = vine.compile(
  vine.object({
    deliveryId: vine.number().positive(),
    channel: vine.enum(['kiosk', 'scanner'] as const),
    expectedPrice: vine.number().withoutDecimals().min(0).optional(),
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
          expectedPrice: vine.number().withoutDecimals().min(0).optional(),
        })
      )
      .minLength(1),
  })
)
