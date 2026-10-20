import '#tests/test_context'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import { ProductFactory } from '#database/factories/product_factory'
import { CategoryFactory } from '#database/factories/category_factory'
import Delivery from '#models/delivery'
import StockAdjustment from '#models/stock_adjustment'
import type User from '#models/user'
import InventoryService from '#services/inventory_service'
import { assertStockInvariants } from '#tests/helpers/stock_invariants'

/**
 * Who may change the stock through the web, and how a refusal reaches the page. Every refused
 * call must leave the lots, the adjustments and the audit log exactly as they were.
 */

const cleanAll = async () => {
  await db.rawQuery('TRUNCATE TABLE users, categories, product_groups CASCADE')
}

const inertia = { 'x-inertia': 'true', 'x-inertia-version': '1' }

async function stocked(supplier: User, amount = 6) {
  const category = await CategoryFactory.create()
  const product = await ProductFactory.merge({ categoryId: category.id }).create()
  const lot = await Delivery.create({
    supplierId: supplier.id,
    productId: product.id,
    amountSupplied: amount,
    amountLeft: amount,
    amountLost: 0,
    price: 20,
    purchasePrice: 15,
  })
  return { product, lot }
}

/** Everything a stock mutation could touch, to compare before and after a refusal. */
async function snapshot() {
  const [lots, adjustments, counts, audit, users] = await Promise.all([
    db
      .from('deliveries')
      .select('id', 'supplier_id', 'amount_supplied', 'amount_left', 'amount_lost', 'price')
      .orderBy('id'),
    db.from('stock_adjustments').select('id', 'reverted_at').orderBy('id'),
    db.from('inventory_counts').count('* as n').first(),
    db.from('audit_logs').count('* as n').first(),
    db.from('users').select('id', 'role', 'is_disabled').orderBy('id'),
  ])
  return { lots, adjustments, counts: counts?.n, audit: audit?.n, users }
}

test.group('Web stock mutations — role gates', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('a customer and a kiosk cannot write off, revert, count, reclassify, reprice or hand over', async ({
    client,
    assert,
  }) => {
    // Catches: any of these routes moved out of the role-guarded group (F-R1).
    const supplier = await UserFactory.apply('supplier').create()
    const colleague = await UserFactory.apply('supplier').create()
    const customer = await UserFactory.create()
    const kiosk = await UserFactory.apply('kiosk').create()
    const { product, lot } = await stocked(supplier)
    const service = new InventoryService()
    const [writeOff] = await service.writeOff(supplier, {
      productId: product.id,
      quantity: 1,
      reason: 'damaged',
    })
    const count = await service.commitCount(supplier, {
      scope: 'all',
      items: [{ productId: product.id, expected: 5, counted: 4 }],
    })
    const before = await snapshot()

    const calls = [
      {
        method: 'post' as const,
        url: '/supplier/stock/write-offs',
        body: { productId: product.id, quantity: 1, reason: 'expired' },
      },
      { method: 'put' as const, url: `/supplier/stock/write-offs/${writeOff.id}/revert`, body: {} },
      {
        method: 'post' as const,
        url: '/supplier/inventory',
        body: { scope: 'all', items: [{ productId: product.id, expected: 4, counted: 0 }] },
      },
      {
        method: 'put' as const,
        url: `/supplier/inventory/${count.id}/products/${product.id}`,
        body: { reason: 'stolen' },
      },
      {
        method: 'post' as const,
        url: '/supplier/stock/reprice',
        body: { items: [{ deliveryId: lot.id, price: 99 }] },
      },
      {
        method: 'post' as const,
        url: `/admin/users/${supplier.id}/transfer-stock`,
        body: { toUserId: colleague.id },
      },
    ]
    for (const [user, home] of [
      [customer, '/'],
      [kiosk, '/kiosk'],
    ] as const) {
      for (const call of calls) {
        const response = await client[call.method](call.url)
          .loginAs(user)
          .withCsrfToken()
          .json(call.body)
          .redirects(0)
        response.assertStatus(302)
        // The kiosk hold covers the supplier section; /admin goes straight to the role check.
        const expected = call.url.startsWith('/admin') ? '/' : home
        assert.equal(response.header('location'), expected, `${home} ${call.method} ${call.url}`)
      }
    }
    // A supplier is not an admin: handing someone's stock over stays refused for them.
    const bySupplier = await client
      .post(`/admin/users/${supplier.id}/transfer-stock`)
      .loginAs(colleague)
      .withCsrfToken()
      .json({ toUserId: colleague.id })
      .redirects(0)
    assert.equal(bySupplier.header('location'), '/')

    assert.deepEqual(await snapshot(), before)
    await assertStockInvariants(assert)
  })

  test('an admin reverts a colleague’s write-off; the owner is the audit target', async ({
    client,
    assert,
  }) => {
    const supplier = await UserFactory.apply('supplier').create()
    const admin = await UserFactory.apply('admin').create()
    const { product, lot } = await stocked(supplier, 5)
    const [row] = await new InventoryService().writeOff(supplier, {
      productId: product.id,
      quantity: 2,
      reason: 'stolen',
    })

    const response = await client
      .put(`/supplier/stock/write-offs/${row.id}/revert`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
    response.assertStatus(302)

    await lot.refresh()
    assert.deepEqual([lot.amountLeft, lot.amountLost], [5, 0])
    const reverted = await StockAdjustment.findOrFail(row.id)
    assert.equal(reverted.revertedBy, admin.id)
    const audit = await db
      .from('audit_logs')
      .where('action', 'stock.write_off_reverted')
      .firstOrFail()
    assert.deepEqual([audit.user_id, audit.target_user_id], [admin.id, supplier.id])
    await assertStockInvariants(assert)
  })
})

test.group('Web write-off — invalid input vs. a refused write-off (F-V1)', (group) => {
  group.each.setup(cleanAll)
  group.each.teardown(cleanAll)

  test('zero pieces is a field error, more than in stock is a refusal; neither changes stock', async ({
    client,
    assert,
  }) => {
    // The page must be able to tell them apart: a validation error belongs under the input
    // (props.errors.quantity), a domain refusal is a danger flash. Both leave the DB alone.
    const supplier = await UserFactory.apply('supplier').create()
    const { product } = await stocked(supplier, 3)
    const before = await snapshot()
    const post = (quantity: number) =>
      client
        .post('/supplier/stock/write-offs')
        .loginAs(supplier)
        .withCsrfToken()
        .headers(inertia)
        .header('referer', '/supplier/stock')
        .json({ productId: product.id, quantity, reason: 'expired' })
        .redirects(1)

    const zero = await post(0)
    assert.isNotEmpty(zero.body().props.errors.quantity)
    assert.notEqual(zero.body().props.flash?.alert?.type, 'success')

    // 4 > 3 in stock: valid input, refused by the service (NOT_ENOUGH_STOCK).
    const tooMany = await post(4)
    assert.isUndefined(tooMany.body().props.errors?.quantity)
    assert.equal(tooMany.body().props.flash.alert.type, 'danger')

    assert.deepEqual(await snapshot(), before)

    // Exactly the stock is fine: 3 of 3.
    const all = await post(3)
    assert.equal(all.body().props.flash.alert.type, 'success')
    const [lot] = await Delivery.all()
    assert.deepEqual([lot.amountLeft, lot.amountLost], [0, 3])
    await assertStockInvariants(assert)
  })
})
