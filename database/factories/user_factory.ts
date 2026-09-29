import factory from '@adonisjs/lucid/factories'
import { DateTime } from 'luxon'
import User from '#models/user'

let keypadCounter = 100

// Codes the kiosk intercepts before looking a customer up (easter egg; the default logout
// code 000000 is never reached). A test user holding one could never be identified.
const RESERVED_KEYPAD_IDS = new Set([666])

function nextKeypadId() {
  while (RESERVED_KEYPAD_IDS.has(keypadCounter)) keypadCounter++
  return keypadCounter++
}

export const UserFactory = factory
  .define(User, ({ faker }) => {
    return {
      displayName: faker.person.fullName(),
      email: faker.internet.email(),
      pendingEmail: null,
      emailVerifiedAt: DateTime.utc(),
      pendingIban: null,
      ibanVerifiedAt: null,
      password: 'password123',
      keypadId: nextKeypadId(),
      role: 'customer' as const,
      isKiosk: false,
      isDisabled: false,
      showAllProducts: false,
      sendMailOnPurchase: true,
      sendDailyReport: true,
      colorMode: 'dark' as const,
      keypadDisabled: false,
      isPremium: false,
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
