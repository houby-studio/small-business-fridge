import '#tests/test_context'
import { test } from '@japa/runner'
import fc from 'fast-check'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import InventoryService from '#services/inventory_service'
import DeliveryService from '#services/delivery_service'
import { planFifoTake } from '#services/stock_fifo'
import { settleSideEffects } from '#services/side_effects'
import { assertStockInvariants } from '#tests/helpers/stock_invariants'
import * as frontend from '../../../inertia/composables/stock_fifo_rules.ts'

/**
 * The write-off dialog previews which lots the pieces come off (inertia/composables/
 * stock_fifo_rules.ts). The preview must be exactly what the server then does — first as two
 * pure functions, then against the real write-off on the database.
 */

const lotsArb = fc.uniqueArray(
  fc.record({
    id: fc.integer({ min: 1, max: 10_000 }),
    amountLeft: fc.integer({ min: -2, max: 30 }),
  }),
  { maxLength: 12, selector: (lot) => lot.id }
)

test.group('stock_fifo_rules parity with app/services/stock_fifo.ts', () => {
  test('both plans are identical for any lots and quantity', ({ assert }) => {
    fc.assert(
      fc.property(lotsArb, fc.integer({ min: -3, max: 200 }), (lots, quantity) => {
        assert.deepEqual(frontend.planFifoTake(lots, quantity), planFifoTake(lots, quantity))
      }),
      { numRuns: 1000 }
    )
  })

  test('a plan takes the oldest lots first and never more than asked or than there is', ({
    assert,
  }) => {
    fc.assert(
      fc.property(lotsArb, fc.integer({ min: 0, max: 200 }), (lots, quantity) => {
        const plan = planFifoTake(lots, quantity)
        const stock = lots.reduce((sum, lot) => sum + Math.max(0, lot.amountLeft), 0)
        const taken = plan.reduce((sum, step) => sum + step.take, 0)
        assert.equal(taken, Math.min(quantity, stock))
        // The plan is a prefix of the lots with pieces, in order; all but the last emptied.
        const withPieces = lots.filter((lot) => lot.amountLeft > 0)
        assert.deepEqual(
          plan.map((step) => step.id),
          withPieces.slice(0, plan.length).map((lot) => lot.id)
        )
        for (const [index, step] of plan.entries()) {
          const lot = withPieces[index]
          if (index < plan.length - 1) assert.equal(step.take, lot.amountLeft)
          else assert.isAtMost(step.take, lot.amountLeft)
        }
      }),
      { numRuns: 500 }
    )
  })
})

test.group('the write-off preview equals the real write-off', (group) => {
  const clean = async () => {
    await settleSideEffects()
    await db.from('audit_logs').delete()
    await db.from('stock_adjustments').delete()
    await db.from('orders').delete()
    await db.from('deliveries').delete()
    await db.from('products').delete()
    await db.from('categories').delete()
    await db.from('users').delete()
  }
  // Write-offs from colleagues' lots e-mail them; keep that off the network.
  group.setup(() => {
    mail.fake()
    return () => mail.restore()
  })
  group.each.setup(clean)
  group.each.teardown(clean)

  test('for random lots of several suppliers (fast-check against the database)', async ({
    assert,
  }) => {
    const inventory = new InventoryService()
    const deliveries = new DeliveryService()
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            supplier: fc.integer({ min: 0, max: 2 }),
            amount: fc.integer({ min: 1, max: 6 }),
            // Several lots may share a timestamp: the id breaks the tie.
            daysAgo: fc.integer({ min: 0, max: 3 }),
          }),
          { minLength: 1, maxLength: 6 }
        ),
        fc.integer({ min: 1, max: 40 }),
        async (spec, wanted) => {
          await clean()
          const suppliers = [
            await UserFactory.apply('supplier').create(),
            await UserFactory.apply('supplier').create(),
            await UserFactory.apply('supplier').create(),
          ]
          const category = await CategoryFactory.create()
          const product = await ProductFactory.merge({ categoryId: category.id }).create()
          const at = DateTime.now().startOf('minute')
          for (const lot of spec) {
            await DeliveryFactory.merge({
              supplierId: suppliers[lot.supplier].id,
              productId: product.id,
              amountSupplied: lot.amount,
              amountLeft: lot.amount,
              amountLost: 0,
              price: 20,
              createdAt: at.minus({ days: lot.daysAgo }),
            }).create()
          }
          const stock = spec.reduce((sum, lot) => sum + lot.amount, 0)
          const quantity = Math.min(wanted, stock)

          // Exactly what the dialog does: the listed lots, then the mirrored plan.
          const listed = await deliveries.listLotsInStock(suppliers[0], product.id)
          const preview = frontend.planFifoTake(
            listed.map((lot) => ({ id: lot.deliveryId, amountLeft: lot.amountLeft })),
            quantity
          )

          const rows = await inventory.writeOff(suppliers[0], {
            productId: product.id,
            quantity,
            reason: 'damaged',
          })
          assert.deepEqual(
            rows.map((row) => ({ id: row.deliveryId, take: row.quantity })),
            preview
          )
        }
      ),
      { numRuns: 15 }
    )
    await assertStockInvariants(assert)
  }).timeout(120_000)
})
