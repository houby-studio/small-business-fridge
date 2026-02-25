import factory from '@adonisjs/lucid/factories'
import Invoice from '#models/invoice'
import { UserFactory } from '#database/factories/user_factory'

export const InvoiceFactory = factory
  .define(Invoice, ({ faker }) => {
    return {
      totalCost: faker.number.int({ min: 10, max: 500 }),
      isPaid: false,
      isPaymentRequested: false,
      autoReminderCount: 0,
      manualReminderCount: 0,
    }
  })
  .state('paid', (invoice) => {
    invoice.isPaid = true
    invoice.isPaymentRequested = true
  })
  .state('paymentRequested', (invoice) => {
    invoice.isPaymentRequested = true
  })
  .relation('buyer', () => UserFactory)
  .relation('supplier', () => UserFactory)
  .build()
