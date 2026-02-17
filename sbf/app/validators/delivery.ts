import vine from '@vinejs/vine'

export const createDeliveryValidator = vine.compile(
  vine.object({
    productId: vine.number().positive(),
    amount: vine.number().positive().min(1),
    price: vine.number().positive().min(1),
  })
)
