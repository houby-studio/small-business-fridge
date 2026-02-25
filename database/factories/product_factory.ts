import factory from '@adonisjs/lucid/factories'
import Product from '#models/product'
import { CategoryFactory } from '#database/factories/category_factory'

let productKeypadCounter = 1

export const ProductFactory = factory
  .define(Product, ({ faker }) => {
    return {
      keypadId: productKeypadCounter++,
      displayName: faker.commerce.productName(),
      description: faker.commerce.productDescription(),
      imagePath: `/images/products/default.png`,
    }
  })
  .relation('category', () => CategoryFactory)
  .build()
