import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Product from '#models/product'
import Category from '#models/category'
import Delivery from '#models/delivery'
import User from '#models/user'
import Allergen from '#models/allergen'
import app from '@adonisjs/core/services/app'

export default class extends BaseSeeder {
  async run() {
    // Only seed in development
    if (!app.inDev) return

    const categories = await Category.all()
    const allergens = await Allergen.all()
    const supplier = await User.findBy('username', 'supplier')
    if (!supplier) return

    const categoryMap = new Map(categories.map((c) => [c.name, c.id]))
    const allergenMap = new Map(allergens.map((a) => [a.name, a.id]))

    const products = await Product.updateOrCreateMany('displayName', [
      {
        keypadId: 1,
        displayName: 'Coca-Cola 0.5L',
        description: 'Osvěžující nápoj',
        imagePath: '/images/products/default.png',
        categoryId: categoryMap.get('Nealko'),
      },
      {
        keypadId: 2,
        displayName: 'Mattoni 0.5L',
        description: 'Přírodní minerální voda',
        imagePath: '/images/products/default.png',
        categoryId: categoryMap.get('Nealko'),
      },
      {
        keypadId: 3,
        displayName: 'Plzeň 0.5L',
        description: 'České pivo',
        imagePath: '/images/products/default.png',
        categoryId: categoryMap.get('Alko'),
      },
      {
        keypadId: 4,
        displayName: 'Snickers',
        description: 'Čokoládová tyčinka s arašídy',
        imagePath: '/images/products/default.png',
        categoryId: categoryMap.get('Sladkosti'),
      },
      {
        keypadId: 5,
        displayName: "Chipsy Lay's",
        description: 'Bramborové lupínky',
        imagePath: '/images/products/default.png',
        categoryId: categoryMap.get('Jídlo'),
      },
    ])

    // Assign allergens per product (by displayName)
    const productAllergens: Record<string, string[]> = {
      'Coca-Cola 0.5L': [],
      'Mattoni 0.5L': [],
      'Plzeň 0.5L': ['Lepek (obiloviny)'],
      'Snickers': ['Arašídy', 'Mléko', 'Skořápkové plody'],
      "Chipsy Lay's": ['Sója'],
    }

    for (const product of products) {
      const allergenNames = productAllergens[product.displayName] ?? []
      const allergenIds = allergenNames
        .map((name) => allergenMap.get(name))
        .filter((id): id is number => id !== undefined)
      await product.related('allergens').sync(allergenIds)
    }

    // Create deliveries for each product
    for (const product of products) {
      await Delivery.updateOrCreate(
        { productId: product.id, supplierId: supplier.id },
        {
          supplierId: supplier.id,
          productId: product.id,
          amountSupplied: 10,
          amountLeft: 10,
          price: product.displayName.includes('Plzeň') ? 25 : 15,
        }
      )
    }
  }
}
