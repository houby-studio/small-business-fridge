import factory from '@adonisjs/lucid/factories'
import Order from '#models/order'
import { UserFactory } from '#database/factories/user_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'

export const OrderFactory = factory
  .define(Order, () => {
    return {
      channel: 'web' as const,
    }
  })
  .state('kiosk', (order) => {
    order.channel = 'kiosk'
  })
  .state('scanner', (order) => {
    order.channel = 'scanner'
  })
  .relation('buyer', () => UserFactory)
  .relation('delivery', () => DeliveryFactory)
  .build()
