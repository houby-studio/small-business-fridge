import '#tests/test_context'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import { DeliveryFactory } from '#database/factories/delivery_factory'
import InventoryService from '#services/inventory_service'
import { settleSideEffects } from '#services/side_effects'
import { assertStockInvariants } from '#tests/helpers/stock_invariants'
import type User from '#models/user'

/**
 * A write-off or an inventory reaches colleagues' lots (FIFO takes the oldest lot, whoever
 * stocked it). Each of those colleagues hears about it — one e-mail per write-off, one
 * summary per inventory — and the person who did it never does.
 */

const inventory = new InventoryService()

const clean = async () => {
  await settleSideEffects()
  await db.from('audit_logs').delete()
  await db.from('stock_adjustments').delete()
  await db.from('inventory_count_items').delete()
  await db.from('inventory_counts').delete()
  await db.from('orders').delete()
  await db.from('deliveries').delete()
  await db.from('products').delete()
  await db.from('categories').delete()
  await db.from('users').delete()
}

async function product(name: string) {
  const category = await CategoryFactory.create()
  return ProductFactory.merge({ categoryId: category.id, displayName: name }).create()
}

async function lot(owner: User, productId: number, amount: number, daysAgo: number) {
  return DeliveryFactory.merge({
    supplierId: owner.id,
    productId,
    amountSupplied: amount,
    amountLeft: amount,
    amountLost: 0,
    price: 20,
    createdAt: DateTime.now().minus({ days: daysAgo }),
  }).create()
}

let fakeMailer: ReturnType<typeof mail.fake>
const sentTo = (user: User) => fakeMailer.messages.sent().filter((m) => m.hasTo(user.email))
const body = (user: User) => JSON.stringify(sentTo(user)[0]?.toJSON() ?? {})

test.group('Write-off and inventory e-mails to colleagues', (group) => {
  group.each.setup(async () => {
    await clean()
    fakeMailer = mail.fake()
  })
  group.each.teardown(async () => {
    await clean()
    mail.restore()
  })

  test('a write-off reaching two colleagues e-mails each of them once, not me', async ({
    assert,
  }) => {
    const [me, anna, petr] = await Promise.all([
      UserFactory.apply('supplier').create(),
      UserFactory.apply('supplier').create(),
      UserFactory.apply('supplier').create(),
    ])
    const kofola = await product('Kofola plech')
    // FIFO: Anna's 2 (oldest), then Petr's 3 over two lots, then mine.
    await lot(anna, kofola.id, 2, 9)
    await lot(petr, kofola.id, 1, 8)
    await lot(petr, kofola.id, 4, 7)
    await lot(me, kofola.id, 5, 1)

    await inventory.writeOff(me, {
      productId: kofola.id,
      quantity: 5,
      reason: 'expired',
      note: 'po záruce',
    })
    assert.deepEqual(await settleSideEffects(), [])

    assert.lengthOf(sentTo(anna), 1)
    assert.lengthOf(sentTo(petr), 1)
    assert.lengthOf(sentTo(me), 0)
    assert.lengthOf(fakeMailer.messages.sent(), 2)

    const toPetr = body(petr)
    assert.include(toPetr, 'Kofola plech')
    assert.include(toPetr, me.displayName)
    assert.include(toPetr, 'Prošlé')
    assert.include(toPetr, 'po záruce')
    // Petr lost 1 + 2 pieces over two lots: the total and each lot are in the mail.
    assert.include(toPetr, '3 ks')
    assert.include(toPetr, DateTime.now().minus({ days: 8 }).toFormat('dd.MM.yyyy'))
    assert.notInclude(toPetr, 'translation missing')
    assert.include(body(anna), '2 ks')
    await assertStockInvariants(assert)
  })

  test('a write-off from my own lots only e-mails nobody', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const kofola = await product('Kofola')
    await lot(me, kofola.id, 3, 5)
    await lot(colleague, kofola.id, 3, 1)

    await inventory.writeOff(me, { productId: kofola.id, quantity: 2, reason: 'damaged' })
    assert.deepEqual(await settleSideEffects(), [])
    assert.lengthOf(fakeMailer.messages.sent(), 0)
  })

  test('an inventory sends each affected colleague one summary of every product', async ({
    assert,
  }) => {
    const [me, anna, petr] = await Promise.all([
      UserFactory.apply('supplier').create(),
      UserFactory.apply('supplier').create(),
      UserFactory.apply('supplier').create(),
    ])
    const kofola = await product('Kofola')
    const tatranka = await product('Tatranka')
    const pepsi = await product('Pepsi')
    await lot(anna, kofola.id, 4, 5)
    await lot(anna, tatranka.id, 3, 5)
    await lot(petr, pepsi.id, 2, 5)
    await lot(me, pepsi.id, 2, 1)

    const count = await inventory.commitCount(me, {
      scope: 'all',
      items: [
        // Anna: 2 Kofola and 1 Tatranka missing. Pepsi: one extra piece on my own lot.
        { productId: kofola.id, counted: 2 },
        { productId: tatranka.id, counted: 2 },
        { productId: pepsi.id, counted: 5 },
      ],
    })
    assert.deepEqual(await settleSideEffects(), [])

    assert.lengthOf(sentTo(anna), 1)
    assert.lengthOf(sentTo(me), 0)
    // The surplus went onto my lot, so Petr's stock did not change — no mail for him.
    assert.lengthOf(sentTo(petr), 0)
    const summary = body(anna)
    assert.include(summary, 'Kofola')
    assert.include(summary, 'manko 2 ks')
    assert.include(summary, 'Tatranka')
    assert.include(summary, 'manko 1 ks')
    assert.include(summary, `/supplier/inventory/${count.id}`)
    assert.include(summary, me.displayName)
    assert.notInclude(summary, 'translation missing')
    await assertStockInvariants(assert)
  })

  test('a surplus on a colleague’s lot is in their summary too', async ({ assert }) => {
    const me = await UserFactory.apply('supplier').create()
    const anna = await UserFactory.apply('supplier').create()
    const kofola = await product('Kofola')
    // Only Anna has this product, so the found piece goes onto her lot.
    const annas = await lot(anna, kofola.id, 4, 5)
    await db.from('deliveries').where('id', annas.id).update({ amount_left: 3 })
    await db.table('orders').insert({
      buyer_id: me.id,
      delivery_id: annas.id,
      channel: 'web',
      unit_price: 20,
      created_at: new Date(),
      updated_at: new Date(),
    })

    await inventory.commitCount(me, { scope: 'all', items: [{ productId: kofola.id, counted: 4 }] })
    assert.deepEqual(await settleSideEffects(), [])
    assert.lengthOf(sentTo(anna), 1)
    assert.include(body(anna), 'přebytek 1 ks')
  })
})
