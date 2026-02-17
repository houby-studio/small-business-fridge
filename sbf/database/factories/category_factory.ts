import factory from '@adonisjs/lucid/factories'
import Category from '#models/category'

export const CategoryFactory = factory
  .define(Category, ({ faker }) => {
    return {
      name: faker.commerce.department(),
      color: faker.color.rgb(),
      isDisabled: false,
    }
  })
  .state('disabled', (category) => {
    category.isDisabled = true
  })
  .build()
