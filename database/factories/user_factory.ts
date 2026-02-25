import factory from '@adonisjs/lucid/factories'
import User from '#models/user'

let keypadCounter = 100

export const UserFactory = factory
  .define(User, ({ faker }) => {
    return {
      displayName: faker.person.fullName(),
      email: faker.internet.email(),
      username: faker.internet.username(),
      password: 'password123',
      keypadId: keypadCounter++,
      role: 'customer' as const,
      isKiosk: false,
      isDisabled: false,
      showAllProducts: false,
      sendMailOnPurchase: true,
      sendDailyReport: true,
      colorMode: 'dark' as const,
      keypadDisabled: false,
    }
  })
  .state('supplier', (user) => {
    user.role = 'supplier'
  })
  .state('admin', (user) => {
    user.role = 'admin'
  })
  .state('kiosk', (user) => {
    user.isKiosk = true
  })
  .state('disabled', (user) => {
    user.isDisabled = true
  })
  .state('withIban', (user, { faker }) => {
    user.iban = `CZ${faker.string.numeric(22)}`
  })
  .build()
