import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'
import app from '@adonisjs/core/services/app'

export default class extends BaseSeeder {
  async run() {
    // Only seed in development
    if (!app.inDev) return

    await User.updateOrCreateMany('email', [
      {
        displayName: 'Admin User',
        email: 'admin@localhost',
        username: 'admin',
        password: 'admin123',
        keypadId: 1,
        role: 'admin',
        iban: 'CZ6508000000192000145399',
        isKiosk: false,
        isDisabled: false,
        showAllProducts: false,
        sendMailOnPurchase: true,
        sendDailyReport: true,
        colorMode: 'dark',
        keypadDisabled: false,
      },
      {
        displayName: 'Supplier User',
        email: 'supplier@localhost',
        username: 'supplier',
        password: 'supplier123',
        keypadId: 2,
        role: 'supplier',
        iban: 'CZ6508000000192000145399',
        isKiosk: false,
        isDisabled: false,
        showAllProducts: false,
        sendMailOnPurchase: true,
        sendDailyReport: true,
        colorMode: 'dark',
        keypadDisabled: false,
      },
      {
        displayName: 'Customer User',
        email: 'customer@localhost',
        username: 'customer',
        password: 'customer123',
        keypadId: 3,
        role: 'customer',
        isKiosk: false,
        isDisabled: false,
        showAllProducts: false,
        sendMailOnPurchase: true,
        sendDailyReport: true,
        colorMode: 'dark',
        keypadDisabled: false,
      },
      {
        displayName: 'Kiosk Device',
        email: 'kiosk@localhost',
        username: 'kiosk',
        password: 'kiosk123',
        keypadId: 4,
        role: 'customer',
        isKiosk: true,
        isDisabled: false,
        showAllProducts: false,
        sendMailOnPurchase: false,
        sendDailyReport: false,
        colorMode: 'dark',
        keypadDisabled: false,
      },
    ])
  }
}
