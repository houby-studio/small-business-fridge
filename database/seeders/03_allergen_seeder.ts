import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Allergen from '#models/allergen'

/** EU 14 major allergens (Czech). Safe to run multiple times. */
export default class extends BaseSeeder {
  async run() {
    await Allergen.updateOrCreateMany('name', [
      { name: 'Lepek (obiloviny)', isDisabled: false },
      { name: 'Korýši', isDisabled: false },
      { name: 'Vejce', isDisabled: false },
      { name: 'Ryby', isDisabled: false },
      { name: 'Arašídy', isDisabled: false },
      { name: 'Sója', isDisabled: false },
      { name: 'Mléko', isDisabled: false },
      { name: 'Skořápkové plody', isDisabled: false },
      { name: 'Celer', isDisabled: false },
      { name: 'Hořčice', isDisabled: false },
      { name: 'Sezam', isDisabled: false },
      { name: 'Oxid siřičitý a siřičitany', isDisabled: false },
      { name: 'Vlčí bob', isDisabled: false },
      { name: 'Měkkýši', isDisabled: false },
    ])
  }
}
