import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Category from '#models/category'

export default class extends BaseSeeder {
  async run() {
    await Category.updateOrCreateMany('name', [
      { name: 'Nealko', color: '#2196F3', isDisabled: false },
      { name: 'Alko', color: '#F44336', isDisabled: false },
      { name: 'Jídlo', color: '#4CAF50', isDisabled: false },
      { name: 'Sladkosti', color: '#FF9800', isDisabled: false },
    ])
  }
}
