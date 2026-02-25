import factory from '@adonisjs/lucid/factories'
import Category from '#models/category'

let categoryCounter = 0

export const CategoryFactory = factory
  .define(Category, ({ faker }) => {
    return {
      name: `${faker.commerce.department()}-${++categoryCounter}`,
      color: faker.color.rgb(),
      isDisabled: false,
    }
  })
  .state('disabled', (category) => {
    category.isDisabled = true
  })
  .build()
