import factory from '@adonisjs/lucid/factories'
import Delivery from '#models/delivery'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'

export const DeliveryFactory = factory
  .define(Delivery, ({ faker }) => {
    const amount = faker.number.int({ min: 5, max: 30 })
    return {
      amountSupplied: amount,
      amountLeft: amount,
      price: faker.number.int({ min: 5, max: 50 }),
    }
  })
  .state('depleted', (delivery) => {
    delivery.amountLeft = 0
  })
  .state('partiallyDepleted', (delivery, { faker }) => {
    delivery.amountLeft = faker.number.int({ min: 1, max: delivery.amountSupplied - 1 })
  })
  .relation('supplier', () => UserFactory)
  .relation('product', () => ProductFactory)
  .build()
